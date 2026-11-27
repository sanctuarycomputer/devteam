// package install and package status (kit-956; kit-install@1's install step, the hub tree and pruning).
// Checks are numbered as in the ticket's spec (I1 to I12). Every run is the real CLI in a fixture
// instance (or, for --into, a copy of the kit outside any repo, as the box has it) against
// test/lib/fake-registry.mjs: a loopback registry, a fake npm first on PATH, and statements signed by
// the fake's own test CA, whose commits name an upstream repo of this file's (git reaches it through
// the registry HOME's url.insteadOf). The fixture's kit copy gains a probe at cmdPackage's start: with
// DT_FS_LOG set it logs every fs write it makes (mkdirSync, writeFileSync, renameSync, symlinkSync,
// unlinkSync, rmSync, rmdirSync) as JSON lines, each with the path (or the two) it names, and with DT_CRASH_AFTER_PLACE set it kills itself
// (SIGKILL) as soon as a step's new folder is renamed into place: a crash between the extract and the
// rename of current.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { kit, bareProject } from './lib/kit.mjs';
import { startFakeRegistry, FIXTURES, NAME } from './lib/fake-registry.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-package-install-'));
const regs = [];
const kids = [];
after(async () => {
  for (const k of kids) { try { k.kill('SIGKILL'); } catch {} }
  for (const r of regs) await r.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
let n = 0;
const scratch = (name) => { const d = path.join(tmp, `${++n}-${name}`); fs.mkdirSync(d, { recursive: true }); return d; };
const g = (args, cwd) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const integrityOf = (version) => `sha512-${crypto.createHash('sha512').update(fs.readFileSync(path.join(FIXTURES, 'registry', `devteam-${version}.tgz`))).digest('base64')}`;
const folderOf = (version) => `${version}-${Buffer.from(integrityOf(version).slice(7), 'base64').toString('hex').slice(0, 12)}`;
const L1 = '0.101.0', L2 = '1.0.0';
const F1 = folderOf(L1), F2 = folderOf(L2);
const REPO = 'sanctuarycomputer/devteam';
const PROBE = `  if (process.env.DT_FS_LOG) {
    const log = fs.openSync(process.env.DT_FS_LOG, 'a');
    for (const op of ['mkdirSync', 'writeFileSync', 'renameSync', 'symlinkSync', 'unlinkSync', 'rmSync', 'rmdirSync']) {
      const was = fs[op];
      fs[op] = (...a) => {
        const r = was.apply(fs, a);
        fs.writeSync(log, JSON.stringify({ op, a: a.slice(0, op === 'renameSync' || op === 'symlinkSync' ? 2 : 1).map((x) => (typeof x === 'string' ? x : null)) }) + '\\n');
        if (op === 'renameSync' && process.env.DT_CRASH_AFTER_PLACE && path.basename(String(a[0])).startsWith('.new-')) process.kill(process.pid, 'SIGKILL');
        return r;
      };
    }
  }
`;

// upstream: v0.101.0 and v1.0.0 tagged on its main; the registry's statements name their commits
function upstream() {
  const u = path.join(scratch('upstream'), 'devteam');
  fs.mkdirSync(u);
  g(['init', '-q', '-b', 'main'], u);
  g(['commit', '-q', '--allow-empty', '-m', 'one'], u);
  g(['tag', '-a', `v${L1}`, '-m', L1], u);
  g(['commit', '-q', '--allow-empty', '-m', 'two'], u);
  g(['tag', '-a', `v${L2}`, '-m', L2], u);
  g(['commit', '-q', '--allow-empty', '-m', 'three'], u);
  const sha = (r) => g(['rev-parse', `${r}^{commit}`], u);
  return { dir: u, commits: { [L1]: sha(`v${L1}`), [L2]: sha(`v${L2}`) } };
}
const UP = upstream();
// a registry of its own per instance, whose HOME's git reaches upstream
async function registry() {
  const reg = await startFakeRegistry({ commits: UP.commits });
  regs.push(reg);
  fs.writeFileSync(path.join(reg.home, '.gitconfig'), `[url "${UP.dir}"]\n\tinsteadOf = https://github.com/${REPO}.git\n`);
  return reg;
}
const clean = () => {
  const e = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') && !/^GIT_/.test(k) && !/^npm_config_/i.test(k)));
  e.DEVTEAM_HUB_PORT = '4999';
  return e;
};
// A fixture instance: the kit copied in with the probe, init run, main pushed to a bare origin, and
// main pinned to { pin } (package pin, committed and pushed).
async function instance(name, { pin = L1 } = {}) {
  const base = scratch(name);
  const origin = path.join(base, 'origin.git');
  const root = bareProject(base, 'pkg');
  const f = path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs');
  const src = fs.readFileSync(f, 'utf8');
  const at = 'function cmdPackage() {\n';
  assert.equal(src.split(at).length, 2, 'the kit declares cmdPackage once');
  fs.writeFileSync(f, src.replace(at, () => `${at}${PROBE}`));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  g(['remote', 'add', 'origin', origin], root);
  g(['add', '-A'], root);
  g(['commit', '-qm', 'init'], root);
  g(['push', '-q', 'origin', 'main'], root);
  const reg = await registry();
  const env = reg.env(clean());
  const fsLog = path.join(base, 'fs.jsonl');
  const dt = (args, extra = {}) => {
    fs.writeFileSync(fsLog, '');
    const r = spawnSync(process.execPath, [f, ...args], { cwd: root, env: { ...env, DT_FS_LOG: fsLog, ...extra }, encoding: 'utf8', timeout: 300000 });
    return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', fs: fs.readFileSync(fsLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
  };
  const pinTo = (version) => {
    const r = dt(['package', 'pin', `v${version}`]);
    assert.equal(r.status, 0, `package pin v${version}: ${r.stderr}`);
    g(['add', 'docs/devteam/package.json', 'docs/devteam/package-lock.json'], root);
    g(['commit', '-qm', `pin ${version}`], root);
    g(['push', '-q', 'origin', 'HEAD:main'], root);
  };
  if (pin) pinTo(pin);
  const kitTree = path.join(root, 'docs', 'devteam', '.kit');
  const hubTree = path.join(reg.home, '.devteam', 'hub');
  return { root, f, reg, env, dt, pinTo, kitTree, hubTree };
}
const current = (tree) => { try { return fs.readlinkSync(path.join(tree, 'current')); } catch { return null; } };
const listing = (tree) => (fs.existsSync(tree) ? fs.readdirSync(tree).sort() : []);
const record = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'verified.json'), 'utf8'));
// a fixture folder copied into a tree under a name of the test's
const seed = (tree, from, as = path.basename(from)) => { fs.mkdirSync(tree, { recursive: true }); fs.cpSync(from, path.join(tree, as), { recursive: true }); };
const seedCurrent = (tree, name) => fs.symlinkSync(name, path.join(tree, 'current'));
// packagePinPair, loaded alone (as test/package-pin.test.mjs loads it)
const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
const packagePinPair = (() => {
  const a = SRC.indexOf('\nfunction packagePinPair(');
  return vm.runInContext(`${SRC.slice(a, SRC.indexOf('\n}\n', a) + 2)}\npackagePinPair`, vm.createContext({}));
})();
// a verified install made by the test: version (and name) with an integrity of its own, or { integrity }
// given; its folder is <version>-<that integrity's 12 hex>, its pair packagePinPair's, its record whole
function verifiedInstall(tree, version, { name = NAME, integrity = `sha512-${crypto.randomBytes(64).toString('base64')}`, layout = 2 } = {}) {
  const folder = `${version}-${Buffer.from(integrity.slice(7), 'base64').toString('hex').slice(0, 12)}`;
  const dir = path.join(tree, folder);
  fs.mkdirSync(dir, { recursive: true });
  const pair = packagePinPair({ name, version, integrity, resolved: `https://registry.npmjs.org/${name}/-/${name.slice(name.indexOf('/') + 1)}-${version}.tgz`, layout });
  for (const f of Object.keys(pair)) fs.writeFileSync(path.join(dir, f), pair[f]);
  fs.writeFileSync(path.join(dir, 'verified.json'), `${JSON.stringify({ v: 1, name, version, layout, integrity, integrity_ok: true, provenance_ok: true, provenance: { repo: REPO, workflow: '.github/workflows/release.yml', ref: `refs/tags/v${version}`, commit: '0'.repeat(40) }, at: '2026-11-27T00:00:00.000Z' }, null, 2)}\n`);
  return folder;
}

test('I1 package install installs main\'s pin through npmRun into .kit/<version>-<12 hex>/ under withLock, verified.json written last', async () => {
  const t = await instance('i1');
  const r = t.dt(['package', 'install']);
  assert.equal(r.status, 0, `I1 install: exit 0 (${r.stderr})`);
  const dir = path.join(t.kitTree, F1);
  assert.equal(current(t.kitTree), F1, 'I1 current names the new folder');
  const rec = record(dir);
  assert.deepEqual(Object.keys(rec), ['v', 'name', 'version', 'layout', 'integrity', 'integrity_ok', 'provenance_ok', 'provenance', 'at'], 'I1 verified.json holds its fields in order');
  assert.deepEqual({ ...rec, at: null }, { v: 1, name: NAME, version: L1, layout: 1, integrity: integrityOf(L1), integrity_ok: true, provenance_ok: true, provenance: { repo: REPO, workflow: '.github/workflows/release.yml', ref: `refs/tags/v${L1}`, commit: UP.commits[L1] }, at: null }, 'I1 verified.json says both checks passed, with the provenance');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', ...NAME.split('/'), 'package.json'), 'utf8')).version, L1, 'I1 the package is installed');
  // through npmRun: ci and audit, each in the step's own folder beside the destination, each kept the rules
  const calls = t.reg.calls().filter((c) => c.argv[0] === 'ci' || c.argv[0] === 'audit');
  assert.deepEqual(calls.map((c) => [c.argv[0], c.status]), [['ci', 0], ['audit', 0]], 'I1 npm ci then npm audit signatures, each once, each passing the fake npm\'s calling rules');
  for (const c of calls) assert.match(path.basename(c.cwd), new RegExp(`^\\.new-${F1.replace(/\./g, '\\.')}-`), 'I1 npm runs in the step\'s own folder');
  // under withLock(.kit/.lock); verified.json the last write before the folder goes into place
  const ops = r.fs.map((o) => [o.op, ...o.a.map((x) => (x ? path.relative(t.kitTree, x) : x))]);
  const lockAt = ops.findIndex(([op, a]) => op === 'mkdirSync' && a === '.lock');
  const unlockAt = ops.findIndex(([op, a]) => op === 'rmSync' && a === '.lock');
  const stageAt = ops.findIndex(([op, a]) => op === 'mkdirSync' && /^\.new-/.test(a));
  const placed = ops.findIndex(([op, a, b]) => op === 'renameSync' && /^\.new-/.test(a) && b === F1);
  const rec1 = ops.findIndex(([op, a, b]) => op === 'renameSync' && /verified\.json\..*\.tmp$/.test(a) && b?.endsWith('/verified.json'));
  assert.ok(lockAt >= 0 && lockAt < stageAt && placed < unlockAt, 'I1 the folder is made under .kit/.lock');
  assert.ok(rec1 > stageAt && rec1 === placed - 1, 'I1 verified.json is written last, by a rename, then the folder is put in place');
});

test('I2 integrity, npm audit signatures (failing, or verifying no attestation), npm older than 9.5 and a provenance refusal each leave no verified.json, current as it was, exit 1 naming it', async () => {
  const t = await instance('i2');
  assert.equal(t.dt(['package', 'install']).status, 0, 'I2 the first install');
  t.pinTo(L2);
  for (const [fail, cause] of [['integrity', 'integrity'], ['attestation-gone', 'audit'], ['no-attestation', 'audit'], ['old-npm', 'old-npm'], ['repo', 'provenance:repo']]) {
    await t.reg.fail(fail);
    const r = t.dt(['package', 'install']);
    assert.equal(r.status, 1, `I2 ${fail}: exit 1 (${r.stdout}${r.stderr})`);
    assert.match(r.stderr, new RegExp(`refused \\(${cause.replace(/[.:]/g, '\\$&')}\\)`), `I2 ${fail}: the failure is named ${cause} (${r.stderr})`);
    assert.equal(current(t.kitTree), F1, `I2 ${fail}: current as it was`);
    assert.deepEqual(listing(t.kitTree), [F1, 'current'].sort(), `I2 ${fail}: no new folder, nothing left of the step`);
    assert.equal(fs.existsSync(t.hubTree), false, `I2 ${fail}: the hub untouched`);
  }
});

test('I3 current switches by an atomic rename: a new link renamed over it, never written in place', async () => {
  const t = await instance('i3');
  for (const v of [L1, L2]) {
    if (v === L2) t.pinTo(L2);
    const r = t.dt(['package', 'install']);
    assert.equal(r.status, 0, `I3 install ${v}: ${r.stderr}`);
    const cur = path.join(t.kitTree, 'current');
    const touching = r.fs.filter((o) => o.a.includes(cur));
    assert.equal(touching.length, 1, `I3 ${v}: one operation names .kit/current (${JSON.stringify(touching)})`);
    assert.equal(touching[0].op, 'renameSync', `I3 ${v}: it is a rename`);
    assert.equal(touching[0].a[1], cur, `I3 ${v}: onto current`);
    const made = r.fs.find((o) => o.op === 'symlinkSync' && o.a[1] === touching[0].a[0]);
    assert.ok(made, `I3 ${v}: what is renamed is a new symlink`);
    assert.equal(current(t.kitTree), folderOf(v), `I3 ${v}: current names it`);
  }
});

test('I4 two installs started at once leave one consistent current', async () => {
  const t = await instance('i4');
  const run = () => new Promise((resolve) => {
    const c = spawn(process.execPath, [t.f, 'package', 'install'], { cwd: t.root, env: t.env, stdio: ['ignore', 'pipe', 'pipe'] });
    kids.push(c);
    let said = '';
    c.stdout.on('data', (b) => { said += b; });
    c.stderr.on('data', (b) => { said += b; });
    c.on('exit', (code) => resolve({ code, said }));
  });
  const [a, b] = await Promise.all([run(), run()]);
  assert.deepEqual([a.code, b.code], [0, 0], `I4 both exit 0 (${a.said} | ${b.said})`);
  assert.equal(current(t.kitTree), F1, 'I4 current names the pin\'s folder');
  assert.deepEqual(listing(t.kitTree), [F1, 'current'].sort(), 'I4 one folder, no second copy, nothing left of either step');
  assert.equal(record(path.join(t.kitTree, F1)).provenance_ok, true, 'I4 that folder is verified');
});

test('I5 a crash between the extract and the rename leaves current as it was; the next run finishes', async () => {
  const t = await instance('i5');
  assert.equal(t.dt(['package', 'install']).status, 0, 'I5 the first install');
  t.pinTo(L2);
  const r = t.dt(['package', 'install'], { DT_CRASH_AFTER_PLACE: '1' });
  assert.equal(r.signal, 'SIGKILL', `I5 the install was killed after the extract (${r.status} ${r.stderr})`);
  assert.equal(current(t.kitTree), F1, 'I5 current as it was');
  assert.ok(r.fs.some((o) => o.op === 'renameSync' && o.a[1] === path.join(t.kitTree, F2)), 'I5 the crash came after the new folder was extracted and put in place');
  // the crashed holder's lock, once stale (30 minutes), is taken by the next run
  const old = new Date(Date.now() - 40 * 60000);
  fs.utimesSync(path.join(t.kitTree, '.lock'), old, old);
  const again = t.dt(['package', 'install']);
  assert.equal(again.status, 0, `I5 the next install: ${again.stderr}`);
  assert.equal(current(t.kitTree), F2, 'I5 the next run switches current');
  assert.equal(t.reg.calls().filter((c) => c.argv[0] === 'ci' && fs.realpathSync(path.dirname(c.cwd)) === fs.realpathSync(t.kitTree)).length, 2, 'I5 to the verified folder the crash left, without installing it again in .kit');
});

test('I6 a verified layout-2 install newer than the hub\'s current also installs into ~/.devteam/hub/ under its lock, with its own verified.json', async () => {
  const t = await instance('i6', { pin: L2 });
  const r = t.dt(['package', 'install']);
  assert.equal(r.status, 0, `I6 install: ${r.stderr}`);
  assert.equal(current(t.kitTree), F2, 'I6 .kit current');
  assert.equal(current(t.hubTree), F2, 'I6 the hub\'s current switched');
  const rec = record(path.join(t.hubTree, F2));
  assert.equal(rec.integrity_ok && rec.provenance_ok && rec.version === L2 && rec.layout === 2, true, 'I6 the hub folder has its own verified.json');
  assert.notEqual(fs.statSync(path.join(t.hubTree, F2, 'verified.json')).ino, fs.statSync(path.join(t.kitTree, F2, 'verified.json')).ino, 'I6 its own file, not .kit\'s');
  const cis = t.reg.calls().filter((c) => c.argv[0] === 'ci');
  assert.equal(cis.length, 2, 'I6 the same step ran twice: .kit, then the hub');
  assert.ok(fs.realpathSync(path.dirname(cis[1].cwd)) === fs.realpathSync(t.hubTree), `I6 the second in the hub tree (${cis[1].cwd})`);
  assert.ok(r.fs.some((o) => o.op === 'mkdirSync' && o.a[0] === path.join(t.hubTree, '.lock')), 'I6 under ~/.devteam/hub/.lock');
});

test('I7 a layout-1 install never touches the hub tree', async () => {
  const t = await instance('i7');
  const r = t.dt(['package', 'install']);
  assert.equal(r.status, 0, `I7 install: ${r.stderr}`);
  assert.equal(fs.existsSync(path.join(t.reg.home, '.devteam')), false, 'I7 no ~/.devteam made');
  assert.equal(r.fs.some((o) => o.a.some((x) => x?.startsWith(t.reg.home))), false, 'I7 nothing written under HOME');
});

test('I8 an older layout-2 install never moves the hub back; another package\'s current holds it, an unverified one does not', async () => {
  const t = await instance('i8', { pin: L2 });
  const newer = verifiedInstall(t.hubTree, '2.0.0');
  seedCurrent(t.hubTree, newer);
  const r = t.dt(['package', 'install']);
  assert.equal(r.status, 0, `I8 install: ${r.stderr}`);
  assert.equal(current(t.kitTree), F2, 'I8 .kit switched');
  assert.equal(current(t.hubTree), newer, 'I8 the hub\'s current as it was');
  assert.deepEqual(listing(t.hubTree), [newer, 'current'].sort(), 'I8 nothing installed in the hub');
  // a verified current of another package, older: left as it is
  fs.rmSync(t.hubTree, { recursive: true, force: true });
  const other = verifiedInstall(t.hubTree, '0.1.0', { name: '@someone/devteam' });
  seedCurrent(t.hubTree, other);
  fs.rmSync(path.join(t.kitTree, 'current'));
  const o = t.dt(['package', 'install']);
  assert.equal(o.status, 0, `I8 install over another package: ${o.stderr}`);
  assert.equal(current(t.hubTree), other, 'I8 another package\'s current holds the hub');
  // an unverified current that names a newer version holds nothing
  fs.rmSync(t.hubTree, { recursive: true, force: true });
  seed(t.hubTree, path.join(FIXTURES, 'hub', F2), '2.0.0-aaaaaaaaaaaa');
  seedCurrent(t.hubTree, '2.0.0-aaaaaaaaaaaa');
  fs.rmSync(path.join(t.kitTree, 'current'));
  const u = t.dt(['package', 'install']);
  assert.equal(u.status, 0, `I8 install over an unverified current: ${u.stderr}`);
  assert.equal(current(t.hubTree), F2, 'I8 an unverified current holds nothing: the hub switched');
});

test('I9 package install --version v --into <dir> works with no project (the box\'s case), into an empty folder, clearing a stopped run\'s leftover', async () => {
  const base = scratch('i9');
  const opt = path.join(base, 'opt', 'kit');
  fs.cpSync(kit, opt, { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  const cwd = path.join(base, 'cwd');
  fs.mkdirSync(cwd);
  assert.notEqual(spawnSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8' }).status, 0, 'I9 the folder is in no repo');
  const reg = await registry();
  const into = path.join(base, 'alpha');
  // the folder made empty beforehand, and what a stopped run left beside it
  fs.mkdirSync(into);
  fs.mkdirSync(path.join(base, '.new-alpha-1-deadbeef'));
  const r = spawnSync(process.execPath, [path.join(opt, 'scripts', 'devteam.mjs'), 'package', 'install', '--version', L1, '--into', into], { cwd, env: reg.env(clean()), encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status, 0, `I9 exit 0 (${r.stdout}${r.stderr})`);
  const rec = record(into);
  assert.deepEqual([rec.version, rec.integrity, rec.integrity_ok, rec.provenance_ok, rec.provenance.repo, rec.provenance.commit], [L1, integrityOf(L1), true, true, REPO, UP.commits[L1]], 'I9 verified, its provenance the kit\'s own upstream');
  assert.equal(JSON.parse(fs.readFileSync(path.join(into, 'node_modules', ...NAME.split('/'), 'package.json'), 'utf8')).version, L1, 'I9 installed in the folder itself');
  assert.equal(fs.existsSync(path.join(opt, '.kit')), false, 'I9 no .kit made');
  assert.equal(fs.existsSync(path.join(base, '.new-alpha-1-deadbeef')), false, 'I9 a stopped run\'s folder beside it removed');
});

test('I10 pruning keeps current and the previous folder in .kit, and a folder a live process holds', async () => {
  const t = await instance('i10');
  for (const v of ['0.99.0-d12588c848a5', '0.100.0-2adfe5123521', F2]) seed(t.kitTree, path.join(FIXTURES, 'kit-link', v));
  seedCurrent(t.kitTree, '0.99.0-d12588c848a5');
  // a process whose cwd is in 0.100.0's folder holds it; one running a script from 1.0.0's folder by
  // its own name (its cwd elsewhere) holds that one
  const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: path.join(t.kitTree, '0.100.0-2adfe5123521'), stdio: 'ignore' });
  kids.push(holder);
  const script = path.join(t.kitTree, F2, 'hold.js');
  fs.writeFileSync(script, 'setInterval(() => {}, 1000);\n');
  const runner = spawn(process.execPath, [script], { cwd: os.tmpdir(), stdio: 'ignore' });
  kids.push(runner);
  await new Promise((r) => setTimeout(r, 300));
  const r = t.dt(['package', 'install']);
  assert.equal(r.status, 0, `I10 install: ${r.stderr}`);
  assert.deepEqual(listing(t.kitTree), ['0.100.0-2adfe5123521', '0.99.0-d12588c848a5', F1, F2, 'current'].sort(), 'I10 current and the previous kept, and the folders a cwd and a command line hold');
  for (const k of [holder, runner]) { k.kill('SIGKILL'); await new Promise((r) => k.once('exit', r)); }
  t.pinTo(L2);
  const r2 = t.dt(['package', 'install']);
  assert.equal(r2.status, 0, `I10 second install: ${r2.stderr}`);
  assert.deepEqual(listing(t.kitTree), [F1, F2, 'current'].sort(), 'I10 once nothing holds it, the next switch removes it with the older folder');
});

test('I11 pruning keeps current and the previous folder in the hub tree', async () => {
  const t = await instance('i11', { pin: L2 });
  seed(t.hubTree, path.join(FIXTURES, 'hub', F2), '0.5.0-aaaaaaaaaaaa');
  seed(t.hubTree, path.join(FIXTURES, 'hub', F2), '0.4.0-bbbbbbbbbbbb');
  seedCurrent(t.hubTree, '0.5.0-aaaaaaaaaaaa');
  const r = t.dt(['package', 'install']);
  assert.equal(r.status, 0, `I11 install: ${r.stderr}`);
  assert.equal(current(t.hubTree), F2, 'I11 the hub switched');
  assert.deepEqual(listing(t.hubTree), ['0.5.0-aaaaaaaaaaaa', F2, 'current'].sort(), 'I11 current and the previous kept, the older removed');
  // removed by moving it out of its name first: no removal ever names the folder itself
  const old = path.join(t.hubTree, '0.4.0-bbbbbbbbbbbb');
  const named = r.fs.filter((o) => o.a.includes(old));
  assert.equal(named.length, 1, `I11 one operation names the pruned folder (${JSON.stringify(named)})`);
  assert.equal(named[0].op, 'renameSync', 'I11 it is a rename');
  assert.match(path.basename(named[0].a[1]), /^\.gone-0\.4\.0-bbbbbbbbbbbb-/, 'I11 out of its name, to .gone-*');
});

test('I12 package status --json prints the pin, current, each install\'s record and the hub pointer', async () => {
  const t = await instance('i12', { pin: L2 });
  assert.equal(t.dt(['package', 'install']).status, 0, 'I12 install');
  // an unverified folder beside it (no verified.json)
  seed(t.kitTree, path.join(FIXTURES, 'kit-link', '0.100.0-2adfe5123521'));
  const r = t.dt(['package', 'status', '--json']);
  assert.equal(r.status, 0, `I12 status: ${r.stderr}`);
  const s = JSON.parse(r.stdout);
  assert.equal(s.registry, t.reg.url, 'I12 the registry');
  assert.deepEqual(s.pin, { name: NAME, version: L2, layout: 2, integrity: integrityOf(L2) }, 'I12 the pin');
  assert.equal(s.kit.current, F2, 'I12 .kit\'s current');
  assert.deepEqual(s.kit.installs.map((i) => [i.folder, i.verified]), [['0.100.0-2adfe5123521', false], [F2, true]], 'I12 each install, verified or not');
  assert.deepEqual(s.kit.installs[1].record, record(path.join(t.kitTree, F2)), 'I12 each install\'s record');
  assert.equal(s.kit.installs[0].record, null, 'I12 no record where there is none');
  assert.equal(s.hub.current, F2, 'I12 the hub pointer');
  assert.equal(fs.realpathSync(s.hub.path), fs.realpathSync(t.hubTree), 'I12 the hub tree\'s path');
});

test('I13 a folder under the pin\'s name is used only when its record names this pin in full; anything else there is moved aside and installed again', async () => {
  const t = await instance('i13');
  // verified, the pin's folder name, but another integrity with the same first 12 hex
  const real = Buffer.from(integrityOf(L1).slice(7), 'base64');
  const twin = Buffer.concat([real.subarray(0, 6), crypto.randomBytes(58)]);
  const folder = verifiedInstall(t.kitTree, L1, { integrity: `sha512-${twin.toString('base64')}`, layout: 1 });
  assert.equal(folder, F1, 'I13 the twin sits under the pin\'s folder name');
  const r = t.dt(['package', 'install']);
  assert.equal(r.status, 0, `I13 install: ${r.stderr}`);
  assert.equal(record(path.join(t.kitTree, F1)).integrity, integrityOf(L1), 'I13 the folder was installed again for the pin');
  const dir = path.join(t.kitTree, F1);
  const first = r.fs.find((o) => o.a.includes(dir));
  assert.equal(first.op, 'renameSync', 'I13 the twin was first moved out of the name');
  assert.match(path.basename(first.a[1]), new RegExp(`^\\.gone-${F1.replace(/\./g, '\\.')}-`), 'I13 to .gone-*');
  assert.deepEqual(listing(t.kitTree), [F1, 'current'].sort(), 'I13 nothing left aside');
});

test('I14 a hub refusal after .kit switched exits 2 and names the hub', async () => {
  const t = await instance('i14', { pin: L2 });
  fs.mkdirSync(path.dirname(t.hubTree), { recursive: true });
  fs.writeFileSync(t.hubTree, 'not a folder\n');
  const r = t.dt(['package', 'install']);
  assert.equal(r.status, 2, `I14 exit 2 (${r.stdout}${r.stderr})`);
  assert.match(r.stderr, /hub: refused \(tree\)/, 'I14 the hub refusal named');
  assert.equal(current(t.kitTree), F2, 'I14 .kit switched');
});
