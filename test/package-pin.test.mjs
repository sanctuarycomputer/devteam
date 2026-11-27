// package pin (kit-955, kit-install@1, decision 2 of kit-package-dist): the pin pair written from the
// registry's manifest, npmRun's calling rules, the best-effort skips and their finding, chore start's
// call for a kit sync, and the .kit ignore line. Checks are numbered as in the ticket's spec (C1 to C10).
// Every run is against test/lib/fake-registry.mjs: a loopback registry and a fake npm first on PATH.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';
import { kit, bareProject } from './lib/kit.mjs';
import { startFakeRegistry, FIXTURES, NAME, PUBLIC } from './lib/fake-registry.mjs';

const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-package-pin-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const scratch = (name) => { const d = path.join(tmp, `${++n}-${name}`); fs.mkdirSync(d, { recursive: true }); return d; };
const PAIR = ['package.json', 'package-lock.json'];
const GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

// packagePinPair, loaded alone (as test/package-contract.test.mjs loads it)
function pinPairFn() {
  const a = SRC.indexOf('\nfunction packagePinPair(');
  assert.ok(a >= 0, 'devteam.mjs declares function packagePinPair');
  const b = SRC.indexOf('\n}\n', a);
  return vm.runInContext(`${SRC.slice(a, b + 2)}\npackagePinPair`, vm.createContext({}));
}
const packagePinPair = pinPairFn();

// A fixture instance: the kit copied in, init run, main pushed to a bare origin of its own.
// { syncOn }: the fixture's kit with chore start's pin turned on (SYNC_PINS, which kit-957 sets; kit-955
// ships it false)
function instance(name, { syncOn = false } = {}) {
  const base = scratch(name);
  const origin = path.join(base, 'origin.git');
  const root = bareProject(base, 'pkg');
  if (syncOn) {
    const f = path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs');
    const src = fs.readFileSync(f, 'utf8');
    assert.equal(src.split('const SYNC_PINS = false;').length, 2, 'the kit declares SYNC_PINS false, once');
    fs.writeFileSync(f, src.replace('const SYNC_PINS = false;', 'const SYNC_PINS = true;'));
  }
  const g = (args, cwd = root) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  g(['remote', 'add', 'origin', origin]);
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  g(['push', '-q', 'origin', 'main']);
  const kitDir = path.join(root, 'docs', 'devteam');
  // the environment a command runs with: no DEVTEAM_* of the machine's, a hub port of its own
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') || /^DEVTEAM_(TEST_.*|CGROUP|MEMINFO)$/.test(k)));
  // a HOME of its own (the fake registry's env() gives each run the registry's), a hub port of its own
  clean.HOME = path.join(base, 'home');
  fs.mkdirSync(clean.HOME);
  clean.DEVTEAM_HUB_PORT = '4999';
  const dt = (args, env, cwd = root) => {
    const r = spawnSync(process.execPath, [path.join(kitDir, 'scripts', 'devteam.mjs'), ...args], { cwd, env, encoding: 'utf8', timeout: 300000 });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const pair = (dir = kitDir) => Object.fromEntries(PAIR.map((f) => [f, fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null]));
  const observations = () => {
    const dir = path.join(kitDir, 'run', 'log');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((o) => o.type === 'observation');
  };
  const findings = (env) => {
    const r = dt(['metrics', '--json'], env);
    assert.equal(r.status, 0, `metrics --json: ${r.stderr}`);
    return JSON.parse(r.stdout).findings.filter((f) => f.kind === 'package-pin-skipped');
  };
  // main's settings with one key set, committed and pushed
  const settle = (key, value) => {
    const f = path.join(root, 'docs/devteam/project/settings.md');
    const txt = fs.readFileSync(f, 'utf8');
    const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
    const j = JSON.parse(m[1]);
    j[key] = value;
    fs.writeFileSync(f, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
  };
  return { base, root, kitDir, g, clean, dt, pair, observations, findings, settle };
}
// the pair packagePinPair makes from the registry's manifest of NAME@version
async function expected(reg, version) {
  const r = await fetch(`${reg.url}${NAME.replace('/', '%2f')}/${version}`);
  assert.equal(r.status, 200, `the fake registry serves ${NAME}@${version}`);
  const m = await r.json();
  // spread: the function runs in a vm context of its own, whose objects have another prototype
  return { pair: { ...packagePinPair({ name: m.name, version: m.version, integrity: m.dist.integrity, resolved: m.dist.tarball, layout: m.devteam.layout }) }, layout: m.devteam.layout };
}

test('C1 package pin <tag> writes the pair packagePinPair makes from the registry\'s manifest, layout from devteam.layout', async () => {
  const I = instance('c1');
  const reg = await startFakeRegistry();
  try {
    const env = reg.env(I.clean);
    for (const version of ['0.101.0', '1.0.0']) {
      const want = await expected(reg, version);
      const r = I.dt(['package', 'pin', `v${version}`], env);
      assert.equal(r.status, 0, `C1 v${version}: exit 0 (${r.stderr})`);
      assert.match(r.stdout, new RegExp(`package pin v${version.replace(/\./g, '\\.')}: pinned ${NAME}@${version.replace(/\./g, '\\.')} \\(layout ${want.layout}`), `C1 v${version}: the line names what it pinned`);
      assert.deepEqual(I.pair(), want.pair, `C1 v${version}: the pair is packagePinPair's, byte for byte`);
    }
    // the layout is the manifest's: 1.0.0's says 2, 0.101.0's 1
    assert.match(I.pair()['package.json'], /"layout": 2/, 'C1 v1.0.0 is layout 2, from its manifest');
    // the kit-952 fixture pair for 0.101.0 is the same bytes
    I.dt(['package', 'pin', 'v0.101.0'], env);
    for (const f of PAIR) assert.equal(I.pair()[f], fs.readFileSync(path.join(FIXTURES, 'pin', f), 'utf8'), `C1 ${f} for v0.101.0 is the fixture's`);
  } finally { await reg.close(); }
});

test('C2 package_name is read from main\'s settings, never the working tree\'s', async () => {
  const I = instance('c2');
  const reg = await startFakeRegistry();
  try {
    const env = reg.env(I.clean);
    // a working-tree name not on main is not read
    I.settle('package_name', '@acme/devteam');
    let r = I.dt(['package', 'pin', 'v0.101.0'], env);
    assert.equal(r.status, 0, `C2 a working-tree name: exit 0 (${r.stderr})`);
    assert.match(r.stdout, new RegExp(`pinned ${NAME}@0\\.101\\.0`), 'C2 the name pinned is main\'s, not the working tree\'s');
    // committed on main, it is the name npm is asked for
    I.g(['commit', '-qam', 'package_name']);
    I.g(['push', '-q', 'origin', 'main']);
    for (const f of PAIR) fs.rmSync(path.join(I.kitDir, f));
    r = I.dt(['package', 'pin', 'v0.101.0'], env);
    const views = reg.calls().filter((c) => c.argv[0] === 'view').map((c) => c.argv[1]);
    assert.equal(views.at(-1), '@acme/devteam@0.101.0', 'C2 npm view asks for main\'s package_name');
    assert.equal(r.status, 0, 'C2 an unpublished name is a skip');
    assert.deepEqual(I.pair(), { 'package.json': null, 'package-lock.json': null }, 'C2 nothing written');
  } finally { await reg.close(); }
});

test('C3 every npm call goes through npmRun: the registry forced, scripts off, npm config from the environment and the project dropped', async () => {
  const I = instance('c3');
  const reg = await startFakeRegistry({ fail: 'hostile-env' });
  try {
    // hostile-env (npm_config_*, NPM_CONFIG_*, a mixed case), one more mixed-case name of the test's own,
    // and .npmrc files in the project naming another registry
    const env = { ...reg.env(I.clean), Npm_Config_Registry: 'http://127.0.0.1:9/', nPm_CoNfIg_IgNoRe_ScRiPtS: 'false' };
    for (const d of [I.root, I.kitDir]) fs.writeFileSync(path.join(d, '.npmrc'), 'registry=http://127.0.0.1:9/\nignore-scripts=false\n');
    const r = I.dt(['package', 'pin', 'v0.101.0'], env);
    // each rule first, so a call that breaks one is named by it; then the fake took every call
    const calls = reg.calls();
    assert.ok(calls.some((c) => c.argv[0] === 'view'), 'C3 npm view was called');
    for (const c of calls) {
      assert.deepEqual(Object.keys(c.npm_env).sort(), ['npm_config_globalconfig', 'npm_config_userconfig'], `C3 only the two config files reach npm (${c.argv[0]})`);
      assert.notEqual(c.npm_env.npm_config_userconfig, c.npm_env.npm_config_globalconfig, 'C3 two different files');
      assert.deepEqual(c.argv.filter((a) => a.startsWith('--registry')), [`--registry=${reg.url}`], 'C3 exactly one --registry=, the test registry');
      assert.equal(c.argv.filter((a) => a === '--ignore-scripts').length, 1, `C3 --ignore-scripts once (${c.argv[0]})`);
      assert.equal(c.status, 0, `C3 the fake npm took ${c.argv.join(' ')}`);
    }
    assert.equal(r.status, 0, `C3 pinned under a hostile environment: ${r.stderr}${r.stdout}`);
  } finally { await reg.close(); }
});

test('C4 with DEVTEAM_NPM_REGISTRY unset npm is given the public registry; any value but a loopback URL stops the pin before npm runs', async () => {
  const I = instance('c4');
  const reg = await startFakeRegistry();
  try {
    const env = { ...reg.env(I.clean), npm_config_registry: reg.url };
    delete env.DEVTEAM_NPM_REGISTRY;
    I.dt(['package', 'pin', 'v0.101.0'], env);
    const view = reg.calls().find((c) => c.argv[0] === 'view');
    assert.ok(view, 'C4 npm view was called');
    assert.deepEqual(view.argv.filter((a) => a.startsWith('--registry')), [`--registry=${PUBLIC}`], 'C4 unset: the public registry, whatever the environment says');
    const before = reg.calls().length;
    for (const bad of ['http://localhost:1/', 'https://127.0.0.1:1/', 'http://127.0.0.1:0/', 'http://127.0.0.1:65536/', 'http://127.0.0.1:01/', `${reg.url}x`, reg.url.slice(0, -1), 'http://[::1]:1/']) {
      const r = I.dt(['package', 'pin', 'v0.101.0'], { ...reg.env(I.clean), DEVTEAM_NPM_REGISTRY: bad });
      assert.equal(r.status, 1, `C4 ${bad}: exit 1`);
      assert.match(r.stderr, /DEVTEAM_NPM_REGISTRY/, `C4 ${bad}: names the variable`);
    }
    assert.equal(reg.calls().length, before, 'C4 no npm call under a bad DEVTEAM_NPM_REGISTRY');
    assert.deepEqual(I.pair(), { 'package.json': null, 'package-lock.json': null }, 'C4 nothing written');
  } finally { await reg.close(); }
});

test('C5 unreachable, unpublished, no npm, an npm older than 9.5: the pair as it was, exit 0, the cause printed, logged and a finding', async () => {
  const I = instance('c5');
  const reg = await startFakeRegistry();
  const SENTINEL = { 'package.json': '{"sentinel":"package.json"}\n', 'package-lock.json': '{"sentinel":"lock"}\n' };
  // a PATH with git and no npm
  const noNpm = scratch('no-npm-bin');
  fs.symlinkSync(GIT, path.join(noNpm, 'git'));
  const cases = [
    { tag: 'v0.101.0', cause: 'unreachable', fail: 'unreachable' },
    { tag: 'v0.100.0', cause: 'unreachable', fail: 'server-error' },
    { tag: 'v9.9.9', cause: 'unpublished', fail: null },
    { tag: 'v0.99.0', cause: 'old-npm', fail: 'old-npm' },
    { tag: 'v1.0.0', cause: 'no-npm', fail: null, path: noNpm },
  ];
  try {
    // the 9.5 edge: an npm of the test's own that says its version and hands every other call to the fake
    const edge = (version) => {
      const bin = scratch(`npm-${version}`);
      fs.writeFileSync(path.join(bin, 'npm'), `#!${process.execPath}\nconst a = process.argv.slice(2);\nif (a[0] === '--version') { console.log(${JSON.stringify(version)}); process.exit(0); }\nconst r = require('node:child_process').spawnSync(${JSON.stringify(path.join(reg.bin, 'npm'))}, a, { stdio: 'inherit' });\nprocess.exit(r.status ?? 1);\n`, { mode: 0o755 });
      const base = reg.env(I.clean);
      return { ...base, PATH: `${bin}${path.delimiter}${base.PATH}` };
    };
    for (const f of PAIR) fs.writeFileSync(path.join(I.kitDir, f), SENTINEL[f]);
    let e = I.dt(['package', 'pin', 'v0.100.0'], edge('9.4.99'));
    assert.match(e.stdout, /skipped \(old-npm\): npm 9\.4\.99 is older than 9\.5/, 'C5 npm 9.4.99 is older than 9.5');
    assert.deepEqual(I.pair(), SENTINEL, 'C5 npm 9.4.99: both files as they were');
    e = I.dt(['package', 'pin', 'v0.100.0'], edge('9.5.0'));
    assert.match(e.stdout, /package pin v0\.100\.0: pinned/, `C5 npm 9.5.0 is new enough (${e.stderr})`);
    for (const f of PAIR) fs.rmSync(path.join(I.kitDir, f));
    for (const c of cases) {
      for (const f of PAIR) fs.writeFileSync(path.join(I.kitDir, f), SENTINEL[f]);
      await reg.fail(c.fail);
      const env = reg.env(I.clean);
      if (c.path) env.PATH = c.path;
      const r = I.dt(['package', 'pin', c.tag], env);
      assert.equal(r.status, 0, `C5 ${c.tag} ${c.fail ?? c.cause}: exit 0 (${r.stderr})`);
      assert.match(r.stdout, new RegExp(`package pin ${c.tag.replace(/\./g, '\\.')}: skipped \\(${c.cause}\\)`), `C5 ${c.tag}: prints the cause`);
      assert.deepEqual(I.pair(), SENTINEL, `C5 ${c.tag}: both files as they were`);
      const o = I.observations().filter((x) => x.kind === 'package-pin-skipped' && x.subject === `package:${c.tag}`).pop();
      assert.ok(o, `C5 ${c.tag}: an observation is logged`);
      assert.match(o.detail, new RegExp(`\\(${c.cause}\\)`), `C5 ${c.tag}: the observation names the cause`);
    }
    // absent files stay absent
    for (const f of PAIR) fs.rmSync(path.join(I.kitDir, f));
    await reg.fail('unreachable');
    I.dt(['package', 'pin', 'v0.101.0'], reg.env(I.clean));
    assert.deepEqual(I.pair(), { 'package.json': null, 'package-lock.json': null }, 'C5 no pair before, none after');
    await reg.fail(null);
    const env = reg.env(I.clean);
    const fs1 = I.findings(env);
    for (const c of cases) {
      const f = fs1.find((x) => x.subject === c.tag);
      assert.ok(f, `C5 ${c.tag}: the supervisor's findings show it`);
      assert.equal(f.severity, 'medium', `C5 ${c.tag}: a medium finding`);
      assert.match(f.detail, new RegExp(`\\(${c.cause}\\)`), `C5 ${c.tag}: the finding names the cause`);
    }
    // a pin of the tag written since clears its finding
    const r = I.dt(['package', 'pin', 'v0.101.0'], env);
    assert.equal(r.status, 0, `C5 the pin, reachable again: ${r.stderr}`);
    assert.ok(!I.findings(env).some((x) => x.subject === 'v0.101.0'), 'C5 a written pin clears its tag\'s finding');
  } finally { await reg.close(); }
});

test('C6 a tag that is not vX.Y.Z exits 1, asks npm nothing and writes nothing', async () => {
  const I = instance('c6');
  const reg = await startFakeRegistry();
  try {
    for (const tag of ['0.101.0', 'v0.101', 'v01.0.0', 'v0.101.0-rc.1', 'v0.101.0 ', 'V0.101.0', 'latest']) {
      const r = I.dt(['package', 'pin', tag], reg.env(I.clean));
      assert.equal(r.status, 1, `C6 ${JSON.stringify(tag)}: exit 1`);
      assert.match(r.stderr, /is not a release tag vX\.Y\.Z/, `C6 ${JSON.stringify(tag)}: says why`);
    }
    // a temp folder it can't make (spec-2 S2-1): exit 1 with the pin's line, never a stack trace
    const r = I.dt(['package', 'pin', 'v0.101.0'], { ...reg.env(I.clean), TMPDIR: path.join(I.base, 'no-such-tmp') });
    assert.equal(r.status, 1, `C6 an unusable TMPDIR: exit 1 (${r.stderr})`);
    assert.match(r.stderr, /package pin v0\.101\.0: can't make a folder under .*no-such-tmp/, 'C6 an unusable TMPDIR: the pin says so');
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'C6 an unusable TMPDIR: no stack trace');
    // run from another git repo (a link's checkout has a docs/devteam too): refused, nothing written anywhere
    const other = scratch('other-repo');
    execFileSync('git', ['init', '-q', '-b', 'main', other]);
    fs.mkdirSync(path.join(other, 'docs', 'devteam'), { recursive: true });
    const o = I.dt(['package', 'pin', 'v0.101.0'], reg.env(I.clean), other);
    assert.equal(o.status, 1, `C6 from another repo: exit 1 (${o.stdout}${o.stderr})`);
    assert.match(o.stderr, /package pin runs in one of home's checkouts/, 'C6 from another repo: says where it runs');
    assert.deepEqual(I.pair(path.join(other, 'docs', 'devteam')), { 'package.json': null, 'package-lock.json': null }, 'C6 from another repo: nothing written there');
    assert.equal(reg.calls().length, 0, 'C6 npm is never called');
    assert.deepEqual(I.pair(), { 'package.json': null, 'package-lock.json': null }, 'C6 nothing written');
  } finally { await reg.close(); }
});

test('C7 chore start devteam-sync-<tag> pins in the new worktree and prints the line; another slug pins nothing', async () => {
  const I = instance('c7', { syncOn: true });
  const reg = await startFakeRegistry();
  try {
    const env = { ...reg.env(I.clean), DEVTEAM_ROLE: 'supervisor' };
    const want = await expected(reg, '0.101.0');
    let r = I.dt(['chore', 'start', 'devteam-sync-v0.101.0'], env);
    assert.equal(r.status, 0, `C7 the chore starts: ${r.stderr}`);
    const wt = path.join(I.root, '.worktrees', 'chore-devteam-sync-v0.101.0');
    assert.equal(fs.realpathSync(r.stdout.trim()), fs.realpathSync(wt), 'C7 stdout is the worktree, as before');
    assert.match(r.stderr, /package pin v0\.101\.0: pinned @sanctuarycomputer\/devteam@0\.101\.0/, 'C7 the pin\'s line is printed');
    assert.deepEqual(I.pair(path.join(wt, 'docs', 'devteam')), want.pair, 'C7 the worktree holds the pair');
    assert.deepEqual(I.pair(), { 'package.json': null, 'package-lock.json': null }, 'C7 the main checkout is untouched');
    let calls = reg.calls().length;
    // started again, the worktree isn't new: no pin
    r = I.dt(['chore', 'start', 'devteam-sync-v0.101.0'], env);
    assert.equal(r.status, 0, `C7 the same chore again: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /package pin/, 'C7 a worktree not new prints no pin line');
    assert.equal(reg.calls().length, calls, 'C7 a worktree not new calls no npm');
    calls = reg.calls().length;
    r = I.dt(['chore', 'start', 'notes-pin'], env);
    assert.equal(r.status, 0, `C7 another chore starts: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /package pin/, 'C7 another slug prints no pin line');
    assert.equal(reg.calls().length, calls, 'C7 another slug calls no npm');
    assert.deepEqual(I.pair(path.join(I.root, '.worktrees', 'chore-notes-pin', 'docs', 'devteam')), { 'package.json': null, 'package-lock.json': null }, 'C7 another slug writes no pin');
  } finally { await reg.close(); }
});

test('C8 a pin that fails never stops the chore from starting', async () => {
  const I = instance('c8', { syncOn: true });
  const reg = await startFakeRegistry({ fail: 'unreachable' });
  try {
    const env = { ...reg.env(I.clean), DEVTEAM_ROLE: 'supervisor' };
    // fails: the pin command exits 1, and the line says the chore goes on
    for (const [slug, e, says, fails] of [
      ['devteam-sync-v0.100.0', env, /package pin v0\.100\.0: skipped \(unreachable\)/, false],
      ['devteam-sync-v0.99.0', { ...env, DEVTEAM_NPM_REGISTRY: 'http://localhost:1/' }, /DEVTEAM_NPM_REGISTRY/, true],
      ['devteam-sync-v1.0.0', { ...env }, null, false],
      ['devteam-sync-nightly', env, /is not a release tag vX\.Y\.Z/, true],
    ]) {
      if (says === null) {
        // npm missing: a PATH holding git alone
        const bin = scratch('git-only');
        fs.symlinkSync(GIT, path.join(bin, 'git'));
        e.PATH = bin;
      }
      const r = I.dt(['chore', 'start', slug], e);
      assert.equal(r.status, 0, `C8 ${slug}: the chore starts (${r.stderr})`);
      assert.ok(fs.existsSync(path.join(I.root, '.worktrees', `chore-${slug}`, 'docs', 'devteam', 'scripts', 'devteam.mjs')), `C8 ${slug}: its worktree is there`);
      assert.match(r.stderr, says ?? /skipped \(no-npm\)/, `C8 ${slug}: the pin's line says why`);
      assert.equal(/; the chore goes on\n/.test(r.stderr), fails, `C8 ${slug}: the line says the chore goes on only when the pin failed`);
      assert.deepEqual(I.pair(path.join(I.root, '.worktrees', `chore-${slug}`, 'docs', 'devteam')), { 'package.json': null, 'package-lock.json': null }, `C8 ${slug}: no pair written`);
    }
  } finally { await reg.close(); }
});

test('C9 the kit as shipped (SYNC_PINS false): chore start devteam-sync-<tag> starts, pins nothing, asks npm nothing', async () => {
  assert.equal(SRC.split('const SYNC_PINS = false;').length, 2, 'C9 the kit ships SYNC_PINS false, once');
  const I = instance('c8b');
  const reg = await startFakeRegistry();
  try {
    const r = I.dt(['chore', 'start', 'devteam-sync-v0.101.0'], { ...reg.env(I.clean), DEVTEAM_ROLE: 'supervisor' });
    assert.equal(r.status, 0, `C9 the chore starts: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /package pin/, 'C9 no pin line');
    assert.equal(reg.calls().length, 0, 'C9 no npm call');
    assert.deepEqual(I.pair(path.join(I.root, '.worktrees', 'chore-devteam-sync-v0.101.0', 'docs', 'devteam')), { 'package.json': null, 'package-lock.json': null }, 'C9 no pair in the sync\'s worktree');
  } finally { await reg.close(); }
});

test('C10 docs/devteam/.gitignore holds .kit beside run/: a file under .kit and a symlink named .kit are ignored', () => {
  const I = instance('c9');
  fs.mkdirSync(path.join(I.kitDir, '.kit', '0.101.0-abc'), { recursive: true });
  fs.writeFileSync(path.join(I.kitDir, '.kit', '0.101.0-abc', 'verified.json'), '{}\n');
  const ignored = (p) => spawnSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: I.root }).status === 0;
  assert.ok(ignored('docs/devteam/.kit/0.101.0-abc/verified.json'), 'C10 a file under docs/devteam/.kit is ignored');
  assert.equal(I.g(['status', '--porcelain', '--untracked-files=all']), '', 'C10 git status shows nothing under .kit');
  fs.rmSync(path.join(I.kitDir, '.kit'), { recursive: true });
  fs.symlinkSync(scratch('elsewhere'), path.join(I.kitDir, '.kit'));
  assert.ok(ignored('docs/devteam/.kit'), 'C10 a symlink named .kit is ignored too');
  // and the kit's own file says it in those words
  const lines = fs.readFileSync(path.join(kit, '.gitignore'), 'utf8').split('\n');
  assert.ok(lines.includes('run/'), 'C10 run/ is still there');
  assert.ok(lines.includes('.kit'), 'C10 the line is .kit, with no slash');
});
