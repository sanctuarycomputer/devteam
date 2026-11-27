// An instance syncs layout-1 releases with the pin, end to end (kit-959; DIST-S2, design kit-package-dist
// D7; kit-sync@2 and kit-install@1 as kit-955 to kit-958 built them). One fixture home lives through the
// whole file, so its tests run in order and each starts where the one before left it (a red one leaves
// the rest red too; read the first). Checks are numbered as in the ticket's spec (E1 to E5).
//   the home   bareProject, pushed to a bare origin, forge "git", upstream_base v1.0.0, no pin yet;
//              every command runs its own kit as the supervisor, as the supervisor runs a sync:
//              chore start devteam-sync-<tag> (which pins), the copy, chore pr, merge --chore
//   upstream   the kit at v1.0.0 to v1.0.5, each tag on its main, reached through url.insteadOf in the
//              registry's HOME: v1.0.1 to v1.0.4 change governance/quality.md, v1.0.2 also the
//              dashboard's start line (so a running dashboard restarts into the copied kit), and v1.0.5
//              carries the launcher's marker as devteam.mjs's second line
//   registry   test/lib/fake-registry.mjs, copied with a fixture folder of this file's own beside it
//              (its registry/ holds 1.0.0 to 1.0.5, 1.0.5 layout 2, each statement naming upstream's
//              commit for its tag), so the fake serves these versions unchanged: a loopback registry,
//              a fake npm first on PATH and statements signed by its own test CA
// Ports: +41/42 the dashboard's hub and base (one dashboard, E2 to E4)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PORTS, kit, bareProject, freePort } from './lib/kit.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-sync-e2e-'));
let reg = null;
const ends = [];
after(async () => {
  for (const e of ends) await e();
  // an install a watcher or merge left running (a red run with .kit/.lock held) is ended, found by its
  // cwd under this file's folder (Linux; elsewhere there is none to find)
  try {
    for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try { if (fs.readlinkSync(`/proc/${pid}/cwd`).startsWith(fs.realpathSync(tmp)) && fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('package\0install')) process.kill(Number(pid), 'SIGKILL'); } catch {}
    }
  } catch {}
  if (reg) await reg.close();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
let n = 0;
const scratch = (name) => { const d = path.join(tmp, `${++n}-${name}`); fs.mkdirSync(d, { recursive: true }); return d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const g = (args, cwd) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trim();
async function within(f, what, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await f(); if (v) return v; await sleep(200); }
  assert.fail(`timed out waiting for ${what}`);
}
const MARK = '// devteam-launcher: kit-package@1';
const REPO = 'sanctuarycomputer/devteam';
const NAME = '@sanctuarycomputer/devteam';
const VERSIONS = ['1.0.0', '1.0.1', '1.0.2', '1.0.3', '1.0.4', '1.0.5'];
const LAYOUT = Object.fromEntries(VERSIONS.map((v) => [v, v === '1.0.5' ? 2 : 1]));
const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
// packagePinPair, loaded alone (as test/package-pin.test.mjs loads it)
const packagePinPair = (() => {
  const a = SRC.indexOf('\nfunction packagePinPair(');
  return vm.runInContext(`${SRC.slice(a, SRC.indexOf('\n}\n', a) + 2)}\npackagePinPair`, vm.createContext({}));
})();

// upstream: the kit at v1.0.0, then a release per tag on its main (the header says what each changes)
function upstream() {
  const u = path.join(scratch('upstream'), 'devteam');
  fs.mkdirSync(u);
  g(['init', '-q', '-b', 'main'], u);
  fs.cpSync(kit, path.join(u, 'docs/devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  g(['add', '-A'], u);
  g(['commit', '-qm', 'v1.0.0'], u);
  g(['tag', '-a', 'v1.0.0', '-m', '1.0.0'], u);
  const script = path.join(u, 'docs/devteam/scripts/devteam.mjs');
  for (const v of VERSIONS.slice(1)) {
    fs.appendFileSync(path.join(u, 'docs/devteam/governance/quality.md'), `\nA rule of v${v}.\n`);
    if (v === '1.0.2') {
      const s = fs.readFileSync(script, 'utf8');
      const t = s.replace('started on http://', 'started (kit 1.0.2) on http://');
      assert.notEqual(t, s, "upstream: the dashboard's start line is in the kit");
      fs.writeFileSync(script, t);
    }
    if (v === '1.0.5') {
      const lines = fs.readFileSync(script, 'utf8').split('\n');
      lines[1] = MARK;
      fs.writeFileSync(script, lines.join('\n'));
    }
    g(['commit', '-qam', `v${v}`], u);
    g(['tag', '-a', `v${v}`, '-m', v], u);
  }
  return { dir: u, commits: Object.fromEntries(VERSIONS.map((v) => [v, g(['rev-parse', `v${v}^{commit}`], u)])) };
}
const UP = upstream();

// anything run from an install appends its argv here: nothing may, before R
const RAN = path.join(tmp, 'ran-an-install');
const ranInstall = () => { try { return fs.readFileSync(RAN, 'utf8'); } catch { return null; } };
// the registry: test/lib/fake-registry.mjs copied beside a fixture folder of this file's own, which it
// reads as its own (FIXTURES is resolved from the module's path): 1.0.0 to 1.0.5, each a tarball of
// package/package.json and a devteam.mjs (1.0.5 also its cli.mjs and bin, as the fixture's 1.0.0 is)
const regRoot = scratch('registry');
fs.mkdirSync(path.join(regRoot, 'test', 'lib'), { recursive: true });
fs.copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'fake-registry.mjs'), path.join(regRoot, 'test', 'lib', 'fake-registry.mjs'));
const regDir = path.join(regRoot, 'test', 'fixtures', 'kit-install', 'registry');
fs.mkdirSync(regDir, { recursive: true });
for (const v of VERSIONS) {
  const stage = scratch(`package-${v}`);
  const p = path.join(stage, 'package');
  fs.mkdirSync(path.join(p, 'docs', 'devteam', 'scripts'), { recursive: true });
  const two = LAYOUT[v] === 2;
  fs.writeFileSync(path.join(p, 'package.json'), `${JSON.stringify({ name: NAME, version: v, description: 'devteam (a package of test/package-sync-e2e.test.mjs)', license: 'MIT', ...(two ? { bin: { devteam: 'docs/devteam/scripts/cli.mjs' } } : {}), devteam: { layout: LAYOUT[v] } }, null, 2)}\n`);
  const said = (f) => `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(RAN)}, \`${v} ${f} \${process.argv.slice(2).join(' ')}\\n\`);\nprocess.exit(3);\n`;
  fs.writeFileSync(path.join(p, 'docs', 'devteam', 'scripts', 'devteam.mjs'), `#!/usr/bin/env node\n${two ? `${MARK}\n` : ''}// devteam ${v}, a package of this test's own: it only says it ran\n${said('devteam.mjs')}`);
  if (two) fs.writeFileSync(path.join(p, 'docs', 'devteam', 'scripts', 'cli.mjs'), `#!/usr/bin/env node\n${said('cli.mjs')}`);
  execFileSync('tar', ['--format=ustar', '-czf', path.join(regDir, `devteam-${v}.tgz`), 'package'], { cwd: stage });
}
fs.writeFileSync(path.join(regDir, 'provenance.json'), `${JSON.stringify(Object.fromEntries(VERSIONS.map((v) => [v, { repo: REPO, workflow: '.github/workflows/release.yml', ref: `refs/tags/v${v}`, commit: UP.commits[v] }])), null, 2)}\n`);
const { startFakeRegistry } = await import(pathToFileURL(path.join(regRoot, 'test', 'lib', 'fake-registry.mjs')).href);
const integrityOf = (v) => `sha512-${crypto.createHash('sha512').update(fs.readFileSync(path.join(regDir, `devteam-${v}.tgz`))).digest('base64')}`;
const folderOf = (v, integrity = integrityOf(v)) => `${v}-${Buffer.from(integrity.slice(7), 'base64').toString('hex').slice(0, 12)}`;
// (spread: an object made in the vm's context has another prototype, which deepEqual tells apart)
const pairOf = (v, integrity = integrityOf(v)) => ({ ...packagePinPair({ name: NAME, version: v, integrity, resolved: `https://registry.npmjs.org/${NAME}/-/devteam-${v}.tgz`, layout: LAYOUT[v] }) });

// ---- the home ---------------------------------------------------------------------------------
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') && !/^GIT_/.test(k) && !/^npm_config_/i.test(k) && !/^TMUX(_PANE)?$/.test(k)));
const settingsFile = (root) => path.join(root, 'docs/devteam/project/settings.md');
const editSettings = (root, fn) => {
  const f = settingsFile(root);
  const t = fs.readFileSync(f, 'utf8');
  const m = /```json devteam\n([\s\S]*?)\n```/.exec(t);
  fs.writeFileSync(f, t.replace(m[1], JSON.stringify(fn(JSON.parse(m[1])), null, 2)));
};
const H = await (async () => {
  const base = scratch('home');
  const origin = path.join(base, 'origin.git');
  const root = bareProject(base, 'synced');
  editSettings(root, (s) => ({ ...s, forge: 'git', upstream_base: 'v1.0.0' }));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  g(['remote', 'add', 'origin', origin], root);
  g(['add', '-A'], root);
  g(['commit', '-qm', 'init at v1.0.0, no pin'], root);
  g(['push', '-q', 'origin', 'main'], root);
  reg = await startFakeRegistry();
  fs.writeFileSync(path.join(reg.home, '.gitconfig'), `[user]\n\temail = t@t\n\tname = t\n[commit]\n\tgpgsign = false\n[url "${UP.dir}"]\n\tinsteadOf = https://github.com/${REPO}.git\n`);
  const env = { ...reg.env(clean()), DEVTEAM_HUB_PORT: String(PORTS + 41), DEVTEAM_PORT_BASE: String(PORTS + 42), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  const script = path.join(root, 'docs/devteam/scripts/devteam.mjs');
  const dt = (args, { cwd = root, extra = {} } = {}) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd, env: { ...env, DEVTEAM_ROLE: 'supervisor', ...extra }, encoding: 'utf8', timeout: 120000 });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  const ok = (args, o) => { const r = dt(args, o); assert.equal(r.status, 0, `${args.join(' ')}: ${r.out}`); return r; };
  const body = path.join(base, 'body.md');
  fs.writeFileSync(body, 'A kit sync.\n\n## One-way doors\n\nNone.\n');
  const kitTree = path.join(root, 'docs/devteam/.kit');
  return {
    base, root, env, dt, ok, kitTree,
    tip: () => { g(['fetch', '-q', 'origin'], root); return g(['rev-parse', 'origin/main'], root); },
    // the main checkout brought up to main after a landing (merge lands on origin and leaves its files
    // as they were), as the supervisor's checkout follows main: what its dashboard then runs
    catchUp: () => { g(['fetch', '-q', 'origin'], root); g(['merge', '-q', '--ff-only', 'origin/main'], root); },
    atMain: (f) => { g(['fetch', '-q', 'origin'], root); try { return g(['show', `origin/main:docs/devteam/${f}`], root); } catch { return null; } },
    current: () => { try { return fs.readlinkSync(path.join(kitTree, 'current')); } catch { return null; } },
    record: (folder) => JSON.parse(fs.readFileSync(path.join(kitTree, folder, 'verified.json'), 'utf8')),
    acts: () => JSON.parse(ok(['log', '--type', 'act', '--json']).stdout).filter((a) => a.class === 'merge-chore'),
    findings: () => JSON.parse(ok(['metrics', '--json']).stdout).findings.filter((x) => x.kind === 'package-pin-skipped'),
    // an owner's governance-edit answer, for --approved
    answered: () => {
      const q = ok(['ask', '--question', `Land it? ${crypto.randomBytes(3).toString('hex')}`, '--class', 'governance-edit', '--reasons', 'owner-only', '--recommendation', 'yes']).stdout.trim();
      ok(['answer', q, 'yes', '--from-chat', '--said', 'yes, land it']);
      return q;
    },
    mergeArgs: (tag) => ['merge', '--chore', `devteam-sync-${tag}`, '--title', `chore-devteam-sync-${tag}: sync the kit to ${tag}`, '--body-file', body],
  };
})();
const strip = (t) => t.replace(/\n$/, '');
const pairAt = (dir) => Object.fromEntries(['package.json', 'package-lock.json'].map((f) => { try { return [f, fs.readFileSync(path.join(dir, 'docs/devteam', f), 'utf8')]; } catch { return [f, null]; } }));
const kitFile = (p) => !/^docs\/devteam\/(project|run)\//.test(p) && p.startsWith('docs/devteam/');
// The copy: every kit file upstream changed since main's upstream_base, byte for byte from the tag
// ('changed'), or the tag's whole kit over the worktree's ('whole': every tracked kit file the tag
// lacks is deleted, the pin pair among them, as a copy that replaces docs/devteam/ does); then
// upstream_base set to the tag.
function copyKit(w, tag, how = 'changed') {
  const baseTag = JSON.parse(/```json devteam\n([\s\S]*?)\n```/.exec(fs.readFileSync(settingsFile(w), 'utf8'))[1]).upstream_base;
  const ls = (args) => g(args, UP.dir).split('\n').filter(Boolean);
  const files = how === 'whole' ? ls(['ls-tree', '-r', '--name-only', tag, '--', 'docs/devteam']).filter(kitFile) : ls(['diff', '--name-only', baseTag, tag, '--', 'docs/devteam']).filter(kitFile);
  if (how === 'whole') {
    const theirs = new Set(files);
    for (const f of g(['ls-files', 'docs/devteam'], w).split('\n').filter(Boolean).filter(kitFile)) if (!theirs.has(f)) g(['rm', '-q', '-f', f], w);
  }
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(w, f)), { recursive: true });
    fs.writeFileSync(path.join(w, f), execFileSync('git', ['show', `${tag}:${f}`], { cwd: UP.dir, maxBuffer: 256 * 1024 * 1024 }));
  }
  editSettings(w, (s) => ({ ...s, upstream_base: tag }));
}
// chore start devteam-sync-<tag>: its worktree, and what the pin said
function start(tag) {
  const r = H.ok(['chore', 'start', `devteam-sync-${tag}`]);
  const w = r.stdout.trim().split('\n').at(-1);
  assert.ok(fs.existsSync(path.join(w, 'docs/devteam')), `chore start made its worktree (${r.out})`);
  return { w, said: r.stderr };
}
const pr = (tag) => H.ok(['chore', 'pr', `devteam-sync-${tag}`, '--title', `sync the kit to ${tag}`]);

// ---- the dashboard (E2 to E4): under a while loop, as the box runs it (kitHandOver: exit), in a
// process group of its own that a watcher ends when this test process goes
const KILLER = `const g = Number(process.argv[1]); const end = () => { try { process.kill(-g, 'SIGKILL'); } catch {} process.exit(0); };
process.stdin.on('end', end); process.stdin.on('close', end); process.stdin.on('error', end); process.stdin.resume();`;
const hello = async (port, ms = 5000) => { try { const r = await fetch(`http://127.0.0.1:${port}/api/hello`, { signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; } };
let D = null;
async function dashboard() {
  const port = await freePort();
  const script = path.join(H.root, 'docs/devteam/scripts/devteam.mjs');
  const loop = `while kill -0 ${process.pid} 2>/dev/null && [ -d '${H.root}' ]; do '${process.execPath}' '${script}' dashboard --port ${port}; sleep 1; done`;
  const env = { ...H.env, DEVTEAM_KIT_WATCH_MS: '500', DEVTEAM_TEST: '1' };
  const p = spawn('sh', ['-c', loop], { cwd: H.root, env, stdio: 'ignore', detached: true });
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
  const log = () => { try { return fs.readFileSync(path.join(H.root, 'docs/devteam/run/dashboard.log'), 'utf8'); } catch { return ''; } };
  const starts = () => log().split('\n').filter((l) => / started (\(kit [\w.]+\) )?on http/.test(l)).map((l) => ({ pid: Number(l.match(/\[(\d+)\]/)?.[1]), line: l }));
  // an install's script run, or a crash (the loop would start it again), is said at once, not left
  // to a timeout or hidden by the next start
  const up = async (what, ms) => within(async () => {
    const r = ranInstall();
    if (r) assert.fail(`${what}: a process ran an install's script (${r.trim()})`);
    const c = /^.*crashed.*$/m.exec(log());
    if (c) assert.fail(`${what}: the dashboard crashed (${c[0].slice(0, 300)})`);
    return (await hello(port))?.kit;
  }, what, ms);
  await up('the looped dashboard with its kit', 120000);
  // what each process the loop started runs: its script and cwd, read while it lives
  const seen = new Map();
  const look = () => { for (const s of starts()) if (!seen.has(s.pid)) { try { seen.set(s.pid, { argv: fs.readFileSync(`/proc/${s.pid}/cmdline`, 'utf8').split('\0').filter(Boolean), line: s.line }); } catch {} } };
  const timer = setInterval(look, 100);
  timer.unref();
  return { port, log, starts, seen, look, up, end: async () => { clearInterval(timer); await end(); } };
}

test('E1 v1.0.1: chore start pins it, the copy, merge --chore lands the pin, installs it verified in .kit, package status says so, and the act holds the version and integrity', { timeout: 240000 }, async () => {
  const S = start('v1.0.1');
  assert.match(S.said, /package pin v1\.0\.1: pinned @sanctuarycomputer\/devteam@1\.0\.1 \(layout 1, sha512-/, 'E1 chore start pinned the release it syncs');
  assert.deepEqual(pairAt(S.w), pairOf('1.0.1'), "E1 the worktree's pair is packagePinPair's for 1.0.1, the registry's integrity");
  copyKit(S.w, 'v1.0.1');
  pr('v1.0.1');
  const r = H.dt(H.mergeArgs('v1.0.1'));
  assert.equal(r.status, 0, `E1 the sync merges: ${r.out}`);
  H.catchUp();
  assert.match(r.stdout, /pin: @sanctuarycomputer\/devteam@1\.0\.1 \(layout 1\) is the registry's, with its provenance; it installs after the merge/, 'E1 merge checked the pin');
  assert.equal(H.atMain('package.json'), strip(pairOf('1.0.1')['package.json']), "E1 the pin landed: main's package.json");
  assert.equal(H.atMain('package-lock.json'), strip(pairOf('1.0.1')['package-lock.json']), "E1 the pin landed: main's package-lock.json");
  assert.equal(H.current(), folderOf('1.0.1'), 'E1 .kit/current names 1.0.1');
  const rec = H.record(folderOf('1.0.1'));
  assert.deepEqual([rec.version, rec.layout, rec.integrity, rec.integrity_ok, rec.provenance_ok, rec.provenance.commit], ['1.0.1', 1, integrityOf('1.0.1'), true, true, UP.commits['1.0.1']], 'E1 its verified.json');
  const st = JSON.parse(H.ok(['package', 'status', '--json']).stdout);
  assert.equal(st.pin?.version, '1.0.1', 'E1 package status: the pin');
  assert.equal(st.kit.current, folderOf('1.0.1'), 'E1 package status: current');
  assert.ok(st.kit.installs.some((i) => i.folder === folderOf('1.0.1') && i.verified), 'E1 package status: verified');
  const act = H.acts().at(-1);
  assert.ok(act?.what.includes(`; pin ${NAME}@1.0.1 ${integrityOf('1.0.1')}`), `E1 the merge act holds the version and integrity (${act?.what})`);
});

test('E2 v1.0.2 with the registry unreachable: chore start goes on unpinned, the sync merges with a finding, the old pin stays; a dashboard restarts into the copied kit', { timeout: 240000 }, async () => {
  D = await dashboard();
  await reg.fail('unreachable');
  let S;
  try { S = start('v1.0.2'); } finally { await reg.fail(null); }
  assert.match(S.said, /package pin v1\.0\.2: skipped \(unreachable\): [^\n]*left as they were/, 'E2 chore start: the pin skipped, the chore started');
  assert.deepEqual(pairAt(S.w), pairOf('1.0.1'), "E2 the worktree keeps main's pin");
  copyKit(S.w, 'v1.0.2');
  pr('v1.0.2');
  // the registry down again for the merge, as it may well be
  await reg.fail('unreachable');
  let r;
  try { r = H.dt(H.mergeArgs('v1.0.2')); } finally { await reg.fail(null); }
  assert.equal(r.status, 0, `E2 an unreachable registry never blocks a layout-1 sync: ${r.out}`);
  assert.match(r.stdout, /merged chore-devteam-sync-v1\.0\.2/, 'E2 merged');
  H.catchUp();
  assert.equal(H.atMain('package-lock.json'), strip(pairOf('1.0.1')['package-lock.json']), 'E2 main keeps the old pin');
  assert.equal(H.atMain('package.json'), strip(pairOf('1.0.1')['package.json']), 'E2 main keeps the old pin (package.json)');
  const f = H.findings().find((x) => JSON.stringify(x).includes('v1.0.2'));
  assert.ok(f && /unreachable/.test(JSON.stringify(f)), `E2 a finding names the skipped pin and why (${JSON.stringify(H.findings())})`);
  assert.equal(H.current(), folderOf('1.0.1'), 'E2 .kit/current still names 1.0.1');
  await within(() => D.starts().some((s) => s.line.includes('started (kit 1.0.2)')), 'E2 the dashboard restarted into the copied kit', 60000).catch((e) => { throw new Error(`${e.message}; its log ends:\n${D.log().slice(-2000)}`); });
  await D.up('E2 the restarted dashboard answers with its kit', 60000);
});

test('E3 v1.0.3 with a tampered integrity is refused, with and without --approved; nothing lands', { timeout: 240000 }, async () => {
  const before = H.tip();
  const S = start('v1.0.3');
  assert.match(S.said, /package pin v1\.0\.3: pinned/, 'E3 chore start pinned it');
  copyKit(S.w, 'v1.0.3');
  // the pin's integrity tampered: another tarball's, the pair otherwise packagePinPair's
  const forged = `sha512-${crypto.createHash('sha512').update('another tarball').digest('base64')}`;
  for (const [f, text] of Object.entries(pairOf('1.0.3', forged))) fs.writeFileSync(path.join(S.w, 'docs/devteam', f), text);
  pr('v1.0.3');
  const why = /the pin @sanctuarycomputer\/devteam@1\.0\.3 differs from the registry: its integrity is [^\n]*it is never merged \(a tampering signal\)/;
  const r = H.dt(H.mergeArgs('v1.0.3'));
  assert.notEqual(r.status, 0, `E3 refused: ${r.out}`);
  assert.match(r.out, why, 'E3 refused, naming the integrity');
  const q = H.answered();
  const a = H.dt([...H.mergeArgs('v1.0.3'), '--approved', q]);
  assert.notEqual(a.status, 0, `E3 refused even with --approved: ${a.out}`);
  assert.match(a.out, why, 'E3 --approved skips nothing');
  // the registry tampered instead: it serves other bytes and a manifest that says so, so the pin
  // package pin writes from it agrees with the manifest, and the signed statement refuses it
  await reg.fail('integrity');
  let t, ta;
  try {
    H.ok(['package', 'pin', 'v1.0.3'], { cwd: S.w });
    assert.notEqual(pairAt(S.w)['package-lock.json'], pairOf('1.0.3')['package-lock.json'], "E3 the pin now holds the tampered registry's integrity");
    pr('v1.0.3');
    t = H.dt(H.mergeArgs('v1.0.3'));
    ta = H.dt([...H.mergeArgs('v1.0.3'), '--approved', q]);
  } finally { await reg.fail(null); }
  const why2 = /the pin @sanctuarycomputer\/devteam@1\.0\.3 differs from the registry: its provenance is refused \(digest\)[^\n]*it is never merged \(a tampering signal\)/;
  assert.notEqual(t.status, 0, `E3 a tampered tarball is refused: ${t.out}`);
  assert.match(t.out, why2, "E3 refused by the statement's digest");
  assert.notEqual(ta.status, 0, `E3 a tampered tarball is refused with --approved: ${ta.out}`);
  assert.match(ta.out, why2, 'E3 --approved skips nothing (the tampered tarball)');
  assert.equal(H.tip(), before, 'E3 nothing landed');
  assert.equal(H.current(), folderOf('1.0.1'), 'E3 .kit/current still names 1.0.1');
  await D.up('E3 the dashboard answers', 30000);
});

test('E4 v1.0.4 whose copy deleted the pair is refused with the fix, then merges after package pin; the dashboard ran throughout and never restarted into an install', { timeout: 240000 }, async () => {
  const before = H.tip();
  const S = start('v1.0.4');
  assert.match(S.said, /package pin v1\.0\.4: pinned/, 'E4 chore start pinned it');
  copyKit(S.w, 'v1.0.4', 'whole');
  assert.deepEqual(pairAt(S.w), { 'package.json': null, 'package-lock.json': null }, 'E4 the copy deleted the pair');
  pr('v1.0.4');
  const r = H.dt(H.mergeArgs('v1.0.4'));
  assert.notEqual(r.status, 0, `E4 refused: ${r.out}`);
  assert.match(r.out, /deletes the pin pair \(docs\/devteam\/package\.json, docs\/devteam\/package-lock\.json missing at its head\): restore main's pair \(git checkout origin\/main -- docs\/devteam\/package\.json docs\/devteam\/package-lock\.json, which needs no registry\) or run devteam\.mjs package pin v1\.0\.4/, 'E4 refused with the fix');
  assert.equal(H.tip(), before, 'E4 nothing landed');
  // the fix the refusal names: package pin in the sync's worktree
  H.ok(['package', 'pin', 'v1.0.4'], { cwd: S.w });
  pr('v1.0.4');
  const m = H.dt(H.mergeArgs('v1.0.4'));
  assert.equal(m.status, 0, `E4 merges after package pin: ${m.out}`);
  H.catchUp();
  assert.equal(H.atMain('package-lock.json'), strip(pairOf('1.0.4')['package-lock.json']), 'E4 main pins 1.0.4');
  await within(() => H.current() === folderOf('1.0.4'), 'E4 .kit/current names 1.0.4', 30000);
  // the dashboard: it answered after every merge, its watcher installed main's new pin unused, and every
  // process the loop started ran the home's own script, never an install's
  await D.up('E4 the dashboard answers after the merge', 30000);
  await within(() => /kit watch: installing main's pin @sanctuarycomputer\/devteam@1\.0\.4/.test(D.log()), "E4 the watcher saw main's new pin", 30000);
  await sleep(3000);
  const h = await within(() => hello(D.port), 'E4 the dashboard answers');
  assert.equal(fs.realpathSync(h.root), fs.realpathSync(H.root), 'E4 the dashboard serves the home');
  D.look();
  assert.doesNotMatch(D.log(), /restarting: [^\n]*\.kit\/current/, 'E4 no restart for a switch of .kit/current under layout 1');
  // kept running: never crashed, and every start but the first followed a restart it chose
  assert.doesNotMatch(D.log(), /crashed/, 'E4 the dashboard never crashed');
  assert.equal(D.starts().length, 1 + (D.log().match(/restarting: /g) ?? []).length, `E4 one start, then one per restart it chose (${D.starts().map((s) => s.line).join(' | ')})`);
  assert.equal(ranInstall(), null, "E4 nothing ran an install's script");
  assert.ok(D.seen.size >= 2, `E4 the first process and the one v1.0.2 started were read (${[...D.seen.keys()].join(', ')})`);
  const live = D.starts().at(-1);
  assert.ok(live && D.seen.has(live.pid), `E4 the live dashboard's process was read (${D.starts().map((s) => s.line).join(' | ')})`);
  const script = fs.realpathSync(path.join(H.root, 'docs/devteam/scripts/devteam.mjs'));
  for (const [pid, s] of D.seen) {
    assert.ok(!s.argv.some((a) => a.includes(`${path.sep}.kit${path.sep}`) || a.includes('node_modules')), `E4 process ${pid} runs no install (${s.argv.join(' ')})`);
    assert.equal(fs.realpathSync(s.argv[1]), script, `E4 process ${pid} runs the home's own script`);
  }
  await D.end();
});

test('E5 v1.0.5, a tag carrying the launcher, is refused without its pin, and merges with it, installed before the merge', { timeout: 240000 }, async () => {
  const before = H.tip();
  // the registry down while it starts: the pin is skipped, so the sync holds main's 1.0.4
  await reg.fail('unreachable');
  let S;
  try { S = start('v1.0.5'); } finally { await reg.fail(null); }
  assert.match(S.said, /package pin v1\.0\.5: skipped \(unreachable\)/, 'E5 the pin skipped at start');
  copyKit(S.w, 'v1.0.5');
  assert.equal(fs.readFileSync(path.join(S.w, 'docs/devteam/scripts/devteam.mjs'), 'utf8').split('\n')[1], MARK, "E5 the copy carries the launcher's marker");
  pr('v1.0.5');
  const r = H.dt(H.mergeArgs('v1.0.5'));
  assert.notEqual(r.status, 0, `E5 refused without its pin: ${r.out}`);
  assert.match(r.out, /v1\.0\.5 carries the launcher \(layout 2\), so its sync must pin it: run devteam\.mjs package pin v1\.0\.5/, 'E5 refused naming the launcher and the fix');
  assert.equal(H.tip(), before, 'E5 nothing landed');
  H.ok(['package', 'pin', 'v1.0.5'], { cwd: S.w });
  assert.deepEqual(pairAt(S.w), pairOf('1.0.5'), 'E5 package pin wrote the layout-2 pair');
  pr('v1.0.5');
  const m = H.dt(H.mergeArgs('v1.0.5'));
  assert.equal(m.status, 0, `E5 merges with its pin: ${m.out}`);
  H.catchUp();
  assert.match(m.stdout, /pin: @sanctuarycomputer\/devteam@1\.0\.5 \(layout 2\) is the registry's, with its provenance; it installs before the merge/, 'E5 checked strict');
  // the before-merge install's own line (--into its folder, no "pin: " before it), not the
  // "pin: package install: …" line the install after a landing prints
  const installedAt = m.stdout.search(/^package install: installed @sanctuarycomputer\/devteam@1\.0\.5 into \S*\/\.kit\/1\.0\.5-[0-9a-f]{12} \(layout 2\), verified$/m);
  assert.ok(installedAt >= 0 && installedAt < m.stdout.indexOf('merged chore-devteam-sync-v1.0.5'), `E5 installed before the merge (${m.stdout})`);
  const act = H.acts().at(-1);
  const rec = H.record(folderOf('1.0.5'));
  assert.ok(rec.integrity_ok && rec.provenance_ok && rec.layout === 2, 'E5 its verified.json');
  assert.ok(rec.at < act.created_at, `E5 verified (${rec.at}) before the merge's act (${act.created_at})`);
  assert.equal(H.current(), folderOf('1.0.5'), 'E5 .kit/current switched to 1.0.5 after the merge');
  assert.equal(fs.readlinkSync(path.join(reg.home, '.devteam', 'hub', 'current')), folderOf('1.0.5'), "E5 the hub's current switched to 1.0.5 (layout 2)");
  assert.ok(act.what.includes(`; pin ${NAME}@1.0.5 ${integrityOf('1.0.5')}`), `E5 the act holds the version and integrity (${act.what})`);
  assert.equal(ranInstall(), null, "E5 nothing ran an install's script");
});
