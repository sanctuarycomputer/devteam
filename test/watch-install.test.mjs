// The dashboard's watcher and the package (kit-958; kit-install@1, design kit-package-dist decision 5):
// it runs the install step once per change of main's lockfile, off its tick, backing off ten minutes
// after a failure; with main pinning layout 1 or nothing it restarts on a kit file change as today;
// with main pinning layout 2 it restarts only once .kit/current names main's pin, and once when
// current switches to it. Checks are numbered as in the ticket's spec (W1 to W6).
// Every dashboard here runs under a while loop (it exits to restart, as the box's does) in a fixture
// instance with an origin, a HOME of the fake registry's own (test/lib/fake-registry.mjs: a loopback
// registry and a fake npm first on PATH), its hub and ports in this file's block, every DEVTEAM_* of
// the shell gone (test/lib/kit.mjs), and DEVTEAM_TEST_KIT_WATCH_CLOCK naming a file of ms the
// watcher adds to its clock.
// Ports: +41/42 each test's hub and base (serial)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync, spawn } from 'node:child_process';
import { PORTS, kit, bareProject, freePort } from './lib/kit.mjs';
import { startFakeRegistry, FIXTURES, NAME } from './lib/fake-registry.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-watch-install-'));
const regs = [];
const ends = [];
after(async () => {
  for (const e of ends) await e();
  // a watcher's install runs detached: one still waiting (a test that failed with .kit/.lock held) is ended
  // here, found by its cwd under this file's folder (Linux; elsewhere there is none to find)
  try {
    for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try { if (fs.readlinkSync(`/proc/${pid}/cwd`).startsWith(fs.realpathSync(tmp)) && fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('package\0install')) process.kill(Number(pid), 'SIGKILL'); } catch {}
    }
  } catch {}
  for (const r of regs) await r.close();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
let n = 0;
const scratch = (name) => { const d = path.join(tmp, `${++n}-${name}`); fs.mkdirSync(d, { recursive: true }); return d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const g = (args, cwd) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// until, with a budget of its own: a red run fails in a minute, not two
async function within(f, what, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await f(); if (v) return v; await sleep(100); }
  assert.fail(`timed out waiting for ${what}`);
}
const integrityOf = (version) => `sha512-${crypto.createHash('sha512').update(fs.readFileSync(path.join(FIXTURES, 'registry', `devteam-${version}.tgz`))).digest('base64')}`;
const folderOf = (integrity, version) => `${version}-${Buffer.from(integrity.slice(7), 'base64').toString('hex').slice(0, 12)}`;
const L1 = '0.101.0', L2 = '1.0.0';
const LAYOUT = { [L1]: 1, [L2]: 2 };
const F1 = folderOf(integrityOf(L1), L1), F2 = folderOf(integrityOf(L2), L2);
const REPO = 'sanctuarycomputer/devteam';
const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
// packagePinPair, loaded alone (as test/package-pin.test.mjs loads it)
const packagePinPair = (() => {
  const a = SRC.indexOf('\nfunction packagePinPair(');
  return vm.runInContext(`${SRC.slice(a, SRC.indexOf('\n}\n', a) + 2)}\npackagePinPair`, vm.createContext({}));
})();
const pairOf = (version, integrity = integrityOf(version), layout = LAYOUT[version]) => packagePinPair({ name: NAME, version, integrity, resolved: `https://registry.npmjs.org/${NAME}/-/${NAME.slice(NAME.indexOf('/') + 1)}-${version}.tgz`, layout });

// upstream: v0.101.0 and v1.0.0 tagged on its main; the registry's statements name their commits
function upstream() {
  const u = path.join(scratch('upstream'), 'devteam');
  fs.mkdirSync(u);
  g(['init', '-q', '-b', 'main'], u);
  g(['commit', '-q', '--allow-empty', '-m', 'one'], u);
  g(['tag', '-a', `v${L1}`, '-m', L1], u);
  g(['commit', '-q', '--allow-empty', '-m', 'two'], u);
  g(['tag', '-a', `v${L2}`, '-m', L2], u);
  const sha = (r) => g(['rev-parse', `${r}^{commit}`], u);
  return { dir: u, commits: { [L1]: sha(`v${L1}`), [L2]: sha(`v${L2}`) } };
}
const UP = upstream();

// A fixture instance on main, pushed to a bare origin (its main is origin/main), with a registry of its
// own whose HOME's git reaches upstream; pinned to { pin } (the generated pair, committed and pushed:
// no registry needed to write it).
async function instance(name, { pin = null } = {}) {
  const base = scratch(name);
  const origin = path.join(base, 'origin.git');
  const root = bareProject(base, 'wi');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  g(['remote', 'add', 'origin', origin], root);
  g(['add', '-A'], root);
  g(['commit', '-qm', 'init'], root);
  g(['push', '-q', 'origin', 'main'], root);
  const reg = await startFakeRegistry({ commits: UP.commits });
  regs.push(reg);
  fs.writeFileSync(path.join(reg.home, '.gitconfig'), `[url "${UP.dir}"]\n\tinsteadOf = https://github.com/${REPO}.git\n`);
  const clock = path.join(base, 'clock');
  fs.writeFileSync(clock, '0\n');
  const env = reg.env({ ...process.env, DEVTEAM_HUB_PORT: String(PORTS + 41), DEVTEAM_PORT_BASE: String(PORTS + 42), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex'), DEVTEAM_KIT_WATCH_MS: '200', DEVTEAM_TEST: '1', DEVTEAM_TEST_KIT_WATCH_CLOCK: clock });
  for (const k of Object.keys(env)) if (/^npm_config_/i.test(k) || /^GIT_/.test(k)) delete env[k];
  delete env.DEVTEAM_DASHBOARD_RESTART;
  const dt = path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs');
  const pinTo = (version) => {
    const pair = pairOf(version);
    for (const f of Object.keys(pair)) fs.writeFileSync(path.join(root, 'docs', 'devteam', f), pair[f]);
    g(['add', 'docs/devteam/package.json', 'docs/devteam/package-lock.json'], root);
    g(['commit', '-qm', `pin ${version}`], root);
    g(['push', '-q', 'origin', 'HEAD:main'], root);
  };
  if (pin) pinTo(pin);
  const kitTree = path.join(root, 'docs', 'devteam', '.kit');
  return { base, root, dt, orig: fs.readFileSync(dt, 'utf8'), reg, env, pinTo, kitTree, clock, setClock: (ms) => fs.writeFileSync(clock, `${ms}\n`) };
}
// a verified install the test makes in .kit (its pair packagePinPair's, its record whole), and current
// switched to a folder by renaming a new symlink over it, as the install step does
function verifiedInstall(t, version, { integrity = integrityOf(version), layout = LAYOUT[version] } = {}) {
  const folder = folderOf(integrity, version);
  const dir = path.join(t.kitTree, folder);
  fs.mkdirSync(dir, { recursive: true });
  const pair = pairOf(version, integrity, layout);
  for (const f of Object.keys(pair)) fs.writeFileSync(path.join(dir, f), pair[f]);
  fs.writeFileSync(path.join(dir, 'verified.json'), `${JSON.stringify({ v: 1, name: NAME, version, layout, integrity, integrity_ok: true, provenance_ok: true, provenance: { repo: REPO, workflow: '.github/workflows/release.yml', ref: `refs/tags/v${version}`, commit: '0'.repeat(40) }, at: '2026-11-27T00:00:00.000Z' }, null, 2)}\n`);
  return folder;
}
function switchCurrent(t, folder) {
  const tmpLink = path.join(t.kitTree, `.current-test-${crypto.randomBytes(3).toString('hex')}`);
  fs.symlinkSync(folder, tmpLink);
  fs.renameSync(tmpLink, path.join(t.kitTree, 'current'));
}
const current = (t) => { try { return fs.readlinkSync(path.join(t.kitTree, 'current')); } catch { return null; } };
// the kit's script, changed: its start line marked with a letter
const kitAs = (t, mark) => { const s = t.orig.replace('started on http://', `started (kit ${mark}) on http://`); assert.notEqual(s, t.orig); fs.writeFileSync(t.dt, s); };

// A dashboard under a while loop, as the box runs it (kitHandOver: exit), in a process group of its
// own that a watcher ends when this test process goes; resolved once /api/hello answers with a kit.
const KILLER = `const g = Number(process.argv[1]); const end = () => { try { process.kill(-g, 'SIGKILL'); } catch {} process.exit(0); };
process.stdin.on('end', end); process.stdin.on('close', end); process.stdin.on('error', end); process.stdin.resume();`;
const hello = async (port, ms = 5000) => { try { const r = await fetch(`http://127.0.0.1:${port}/api/hello`, { signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; } };
async function dashboard(t, extra = {}) {
  const port = await freePort();
  const loop = `while kill -0 ${process.pid} 2>/dev/null && [ -d '${t.root}' ]; do '${process.execPath}' '${t.dt}' dashboard --port ${port}; sleep 1; done`;
  const p = spawn('sh', ['-c', loop], { cwd: t.root, env: { ...t.env, ...extra }, stdio: 'ignore', detached: true });
  p.on('error', () => {});
  const w = spawn(process.execPath, ['-e', KILLER, String(p.pid)], { detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
  w.on('error', () => {});
  w.stdin.on('error', () => {});
  w.unref();
  w.stdin.unref();
  p.unref();
  const end = async () => {
    try { w.kill('SIGKILL'); } catch {}
    w.stdin.destroy();
    for (let i = 0; i < 200; i++) { try { process.kill(-p.pid, 'SIGKILL'); } catch { break; } await sleep(50); }
  };
  ends.push(end);
  const log = () => { try { return fs.readFileSync(path.join(t.root, 'docs/devteam/run/dashboard.log'), 'utf8'); } catch { return ''; } };
  const starts = () => log().split('\n').filter((l) => / started (\(kit \w\) )?on http/.test(l)).map((l) => ({ pid: Number(l.match(/\[(\d+)\]/)?.[1]), line: l }));
  await within(async () => (await hello(port))?.kit, 'the looped dashboard with its kit', 120000);
  return { port, log, starts, end, count: (re) => (log().match(new RegExp(re.source, 'g')) ?? []).length };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const ci = (t) => t.reg.calls().filter((c) => c.argv[0] === 'ci').length;

test('W1 main\'s lockfile changing to another version runs the install step once, off the dashboard\'s tick and outliving a restart', { timeout: 240000 }, async () => {
  const t = await instance('w1');
  const d = await dashboard(t);
  await sleep(1000);
  // .kit's lock held: the step the watcher starts waits in it, and the dashboard must not
  fs.mkdirSync(path.join(t.kitTree, '.lock'), { recursive: true });
  t.pinTo(L1);
  await within(() => t.reg.calls().some((c) => c.argv[0] === '--version'), 'W1 the install step started for main\'s new pin');
  // detached: the install is in a process group of its own, so a pane's respawn-pane -k, which ends the
  // dashboard's group, leaves it (Linux /proc: field 5 of stat is the group)
  const group = (pid) => Number(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /s, '').split(' ')[2]);
  const installs = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).filter((pid) => { try { return fs.readlinkSync(`/proc/${pid}/cwd`) === fs.realpathSync(t.root) && fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('package\0install'); } catch { return false; } });
  assert.equal(installs.length, 1, 'W1 one install process');
  assert.notEqual(group(installs[0]), group(d.starts()[0].pid), 'W1 the install runs in a process group of its own');
  for (let i = 0; i < 5; i++) {
    const at = Date.now();
    assert.ok((await hello(d.port, 2000))?.kit, 'W1 the dashboard answers while the install waits');
    assert.ok(Date.now() - at < 2000, 'W1 within 2 s');
    await sleep(300);
  }
  // a kit change while the install still waits: the restart neither waits for it nor ends it
  const first = d.starts()[0].pid;
  kitAs(t, 'B');
  await within(() => d.starts().some((s) => s.line.includes('started (kit B)')), 'W1 restarted while the install waits', 15000);
  assert.equal(alive(first), false, 'W1 the old process is gone');
  assert.equal(current(t), null, 'W1 the install is still waiting');
  fs.rmdirSync(path.join(t.kitTree, '.lock'));
  await within(() => current(t) === F1, 'W1 the install outlived the restart and switched current to main\'s pin');
  await sleep(3000);
  assert.equal(ci(t), 1, 'W1 npm ci ran once for the change');
  assert.equal(d.count(/kit watch: installing /), 1, 'W1 one install started for the one change, the new process none');
});

test('W2 after a failed install the watcher waits at least ten minutes (its clock) before trying that version again; another version goes at once', { timeout: 240000 }, async () => {
  const t = await instance('w2');
  const d = await dashboard(t, { DEVTEAM_DASHBOARD_RESTART: 'off' });
  await sleep(1000);
  await t.reg.fail('unreachable');
  t.pinTo(L1);
  await within(() => /kit watch: package install failed/.test(d.log()), 'W2 the failed install said');
  assert.equal(ci(t), 1, 'W2 one try');
  await sleep(3000);
  assert.equal(ci(t), 1, 'W2 not tried again while the clock stands');
  t.setClock(590000);
  await sleep(3000);
  assert.equal(ci(t), 1, 'W2 not tried again at 9 min 50 s');
  // main moves to another version, the clock back where it was: no wait for it
  t.setClock(0);
  t.pinTo(L2);
  await within(() => ci(t) === 2, 'W2 the new version tried at once', 5000);
  await t.reg.fail(null);
  await sleep(3000);
  assert.equal(ci(t), 2, 'W2 the new version\'s failure waits too');
  t.setClock(620000);
  await within(() => current(t) === F2, 'W2 tried again after ten minutes, and installed');
  assert.equal(ci(t), 3, 'W2 three tries in all; the old version never again');
});

test('W3 with main pinning layout 1 or nothing, a kit file change restarts as today, whatever the install did', { timeout: 240000 }, async () => {
  const t = await instance('w3');
  // polls a second apart, so the kit rewritten every 50 ms never reads the same twice running even on a slow machine
  const d = await dashboard(t, { DEVTEAM_KIT_WATCH_MS: '1000' });
  const first = d.starts()[0].pid;
  // nothing pinned: a kit file change restarts it
  kitAs(t, 'B');
  await within(() => d.starts().some((s) => s.line.includes('started (kit B)')), 'W3 nothing pinned: the kit file change restarted it');
  assert.equal(alive(first), false, 'W3 the old process is gone');
  await within(async () => (await hello(d.port))?.kit, 'W3 kit B answers');
  // a kit that keeps changing (a sync still writing) is waited for: two equal polls first
  const before = d.count(/restarting: /);
  const churnEnd = Date.now() + 4000;
  for (let i = 0; Date.now() < churnEnd; i++) { fs.writeFileSync(t.dt, `${t.orig}\n// churn ${i}\n`); await sleep(50); }
  assert.equal(d.count(/restarting: /), before, 'W3 no restart while the kit keeps changing');
  await within(() => d.count(/restarting: /) === before + 1 && d.starts().length === 3, 'W3 the kit, settled, restarted it once');
  await within(async () => (await hello(d.port))?.kit, 'W3 the settled kit answers');
  // node --check still guards it
  const second = d.starts().at(-1).pid;
  fs.writeFileSync(t.dt, `${t.orig}\n}}}\n`);
  await within(() => /does not parse/.test(d.log()), 'W3 the broken kit named');
  await sleep(2000);
  assert.equal(d.count(/does not parse/), 1, 'W3 said once');
  assert.ok(alive(second), 'W3 a kit that does not parse is not started');
  kitAs(t, 'C');
  await within(() => d.starts().some((s) => s.line.includes('started (kit C)')), 'W3 nothing pinned: the fixed kit restarted it');
  await within(async () => (await hello(d.port))?.kit, 'W3 kit C answers');
  // the new process reads main's pin on its first tick and takes it as its start: pin after that
  await sleep(2500);
  // layout 1 pinned, its install failed; a current that switches under layout 1 restarts nothing
  await t.reg.fail('unreachable');
  t.pinTo(L1);
  await within(() => /kit watch: package install failed/.test(d.log()), 'W3 the install failed');
  switchCurrent(t, verifiedInstall(t, L1));
  await sleep(5000);
  assert.equal(d.count(/restarting: /), 3, 'W3 layout 1: a current switch restarts nothing');
  kitAs(t, 'D');
  await within(() => d.starts().some((s) => s.line.includes('started (kit D)')), 'W3 layout 1, install failed: the kit file change restarted it');
  assert.equal(d.count(/restarting: /), 4, 'W3 four restarts, one per settled kit change');
});

test('W4 with main pinning layout 2, a kit file change waits until .kit/current names main\'s pin, saying why once', { timeout: 240000 }, async () => {
  const t = await instance('w4', { pin: L2 });
  switchCurrent(t, verifiedInstall(t, L1));
  const d = await dashboard(t);
  const first = d.starts()[0].pid;
  kitAs(t, 'B');
  await sleep(3000);
  assert.equal(d.count(/restarting: /), 0, 'W4 held: no restart while current names another folder');
  assert.ok(alive(first) && (await hello(d.port)), 'W4 the first dashboard still serves');
  assert.equal(d.count(new RegExp(`waiting for docs/devteam/\\.kit/current to name main's pin ${F2.replace(/\./g, '\\.')}`)), 1, 'W4 why, said once');
  switchCurrent(t, verifiedInstall(t, L2));
  await within(() => d.starts().some((s) => s.line.includes('started (kit B)')), 'W4 restarted once current names main\'s pin');
  await sleep(3000);
  assert.equal(d.count(/restarting: /), 1, 'W4 one restart');
  assert.equal(d.starts().length, 2, 'W4 two starts in all');
});

test('W5 with main pinning layout 2, current switching to main\'s pin restarts the dashboard once; to another install, it holds', { timeout: 240000 }, async () => {
  const t = await instance('w5', { pin: L2 });
  switchCurrent(t, verifiedInstall(t, L1));
  const d = await dashboard(t);
  await sleep(2000);
  assert.equal(d.count(/restarting: /), 0, 'W5 nothing changed: no restart');
  // current names main's pin's folder, but its record isn't verified (integrity_ok false): hold
  const f2 = verifiedInstall(t, L2);
  const rec = path.join(t.kitTree, f2, 'verified.json');
  fs.writeFileSync(rec, fs.readFileSync(rec, 'utf8').replace('"integrity_ok": true', '"integrity_ok": false'));
  switchCurrent(t, f2);
  await sleep(3000);
  assert.equal(d.count(/restarting: /), 0, 'W5 current names main\'s pin unverified: no restart');
  assert.equal(d.count(new RegExp(`it names ${F2.replace(/\./g, '\\.')}, unverified`)), 1, 'W5 unverified: why, said once');
  // the same folder, verified, but its record and pair say layout 1: hold
  assert.equal(verifiedInstall(t, L2, { layout: 1 }), f2);
  await sleep(3000);
  assert.equal(d.count(/restarting: /), 0, 'W5 current names main\'s pin with a layout-1 record: no restart');
  assert.equal(d.count(/waiting for docs\/devteam\/\.kit\/current to name main's pin/), 1, 'W5 still the one why');
  // its valid record written: once
  verifiedInstall(t, L2);
  await within(() => d.count(/restarting: /) === 1 && d.starts().length === 2, 'W5 restarted when current switched to main\'s pin', 20000);
  assert.match(d.log(), new RegExp(`restarting: docs/devteam/\\.kit/current switched to ${F2.replace(/\./g, '\\.')}`), 'W5 the restart names the switch');
  await within(async () => (await hello(d.port))?.kit, 'W5 the new process answers');
  await sleep(3000);
  assert.equal(d.count(/restarting: /), 1, 'W5 once: the new process starts on that current');
  // a layout-2 install that is not main's pin
  const why = d.count(/waiting for docs\/devteam\/\.kit\/current to name main's pin/);
  switchCurrent(t, verifiedInstall(t, L2, { integrity: `sha512-${crypto.randomBytes(64).toString('base64')}` }));
  await sleep(3000);
  assert.equal(d.count(/restarting: /), 1, 'W5 current names another install: no restart');
  assert.equal(d.count(/waiting for docs\/devteam\/\.kit\/current to name main's pin/), why + 1, 'W5 why, said once');
});

test('W6 kit files and main\'s pin moving together to layout 2 hold the restart even with a pin read in flight', { timeout: 240000 }, async () => {
  const t = await instance('w6', { pin: L1 });
  switchCurrent(t, verifiedInstall(t, L1));
  // a git whose ls-tree takes 1.5 s: the read the watcher has in flight when the two move is of the old pin
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = path.join(t.base, 'slowgit');
  fs.mkdirSync(bin);
  // it reads first and answers 1.5 s later, so what it answers is main as it was when the read began
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nif [ "$1" = ls-tree ]; then o=$('${real}' "$@"); r=$?; sleep 1.5; [ -n "$o" ] && printf '%s\\n' "$o"; exit $r; fi\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const d = await dashboard(t, { PATH: `${bin}${path.delimiter}${t.env.PATH}` });
  // past its first pin read (1.5 s), so main's L1 pin is what it started on
  await sleep(4000);
  // the install the pin change starts waits on .kit/.lock until the test lets it go
  fs.mkdirSync(path.join(t.kitTree, '.lock'));
  kitAs(t, 'B');
  t.pinTo(L2);
  // its outcome, whichever comes: the hold said, or a restart
  await within(() => /waiting for docs\/devteam\/\.kit\/current to name main's pin|restarting: /.test(d.log()), 'W6 the move judged', 30000);
  await sleep(1000);
  assert.equal(d.count(/restarting: /), 0, 'W6 no restart judged on the pin read before the move');
  assert.equal(d.count(/waiting for docs\/devteam\/\.kit\/current to name main's pin/), 1, 'W6 held, said once');
  fs.rmdirSync(path.join(t.kitTree, '.lock'));
  await within(() => current(t) === F2, 'W6 the watcher\'s install switched current to main\'s pin');
  await within(() => d.starts().some((s) => s.line.includes('started (kit B)')), 'W6 restarted once current names main\'s pin');
});
