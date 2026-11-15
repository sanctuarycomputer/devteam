// The machine's commands (machine status|tell|alert|pane-state) and recover --machine as a box runs
// it (cloud/Dockerfile's box-recover): every project on the machine, real tmux on this file's own
// server, stand-in agents, and repos on kits from before recover, taken from the release tags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { HARNESS_ENV, bareProject, hasTmux, kit, testDir, until, write } from './lib/kit.mjs';

// tmux reads UTF-8 from the locale's name: the prompt's ❯ and its non-breaking space must survive
process.env.LANG = process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8';
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_CONFIG_DIR)$/.test(k)) delete process.env[k];
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-machine-')));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
const home = path.join(tmp, 'home');
const code = path.join(home, 'code');
fs.mkdirSync(code, { recursive: true });
const REPO = path.resolve(testDir, '..');
const KIT = path.join(kit, 'scripts', 'devteam.mjs');
// gh that knows one release, a mise with nothing missing, and a claude that notes how it was run and
// stays up as node (what a real one shows as, to tmux): first on PATH, and the only claude a pane's shell finds
const bin = path.join(tmp, 'bin');
const latestRelease = path.join(tmp, 'latest');
fs.writeFileSync(latestRelease, 'v9.9.9\n');
write(path.join(bin, 'gh'), `#!/bin/sh\n[ "$1" = release ] && cat '${latestRelease}' 2>/dev/null\nexit 0\n`);
write(path.join(bin, 'mise'), '#!/bin/sh\nexit 0\n');
write(path.join(bin, 'claude'), `#!/bin/sh\nprintf '%s|%s\\n' "$DEVTEAM_ROLE" "$(printf '%s' "$*" | tr '\\n' ' ')" >> .claude-calls\nexec ${JSON.stringify(process.execPath)} -e 'setInterval(() => {}, 1e6)'\n`);
const stubShell = path.join(bin, 'stubshell');
write(stubShell, `#!/bin/sh\nPATH=${bin}:/usr/bin:/bin\nexport PATH\nENV=/dev/null\nexport ENV\ncase "$1" in -c) exec /bin/sh "$@" ;; *) exec /bin/sh -i ;; esac\n`);
for (const f of ['gh', 'mise', 'claude', 'stubshell']) fs.chmodSync(path.join(bin, f), 0o755);
const baseEnv = { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}`, DEVTEAM_TELL_SETTLE_SECONDS: '0.3', DEVTEAM_MACHINE_EPOCH: 'boot2' };
const tmuxSh = (args) => spawnSync('tmux', args, { encoding: 'utf8', env: baseEnv });
if (hasTmux) {
  execFileSync('tmux', ['new-session', '-d', '-s', 'keep', '-x', '200', '-y', '50', 'sleep 86400'], { env: baseEnv });
  execFileSync('tmux', ['set-option', '-g', 'default-shell', stubShell], { env: baseEnv });
}

// the kit under test, run from a folder that is no project, as the box's commands run it
const nowhere = path.join(tmp, 'nowhere');
fs.mkdirSync(nowhere);
const machine = (args, env = {}) => spawnSync(process.execPath, [KIT, ...args], { cwd: nowhere, encoding: 'utf8', env: { ...baseEnv, ...env } });
const dtIn = (r, args, env = {}) => spawnSync(process.execPath, [path.join(r, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: r, encoding: 'utf8', env: { ...baseEnv, ...env } });
const lines = (r) => Object.fromEntries(r.stdout.trim().split('\n').filter(Boolean).map((l) => { const i = l.indexOf(': '); return [l.slice(0, i), l.slice(i + 2)]; }));

// A release's kit, from its tag: what a repo that hasn't synced yet runs. A shallow CI checkout has
// no tags, so the one needed is fetched; a checkout that can't get it skips, never in CI.
const kits = new Map();
function kitAt(tag) {
  if (kits.has(tag)) return kits.get(tag);
  const has = () => spawnSync('git', ['rev-parse', '--verify', '-q', `${tag}^{commit}`], { cwd: REPO }).status === 0;
  if (!has()) spawnSync('git', ['fetch', '-q', '--depth=1', 'origin', 'tag', tag], { cwd: REPO, stdio: 'ignore', timeout: 60000 });
  if (!has()) { kits.set(tag, null); return null; }
  const dir = path.join(tmp, 'kits', tag);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['-x', '-C', dir], { input: execFileSync('git', ['archive', '--format=tar', tag, 'docs/devteam'], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }) });
  kits.set(tag, path.join(dir, 'docs', 'devteam'));
  return kits.get(tag);
}
const OLD = ['v0.25.0', 'v0.28.0', 'v0.30.0'];
const tagsMissing = () => [...OLD, 'v0.32.0'].filter((t) => !kitAt(t));
const skipOld = () => { const m = tagsMissing(); if (m.length && process.env.CI) throw new Error(`no ${m.join(', ')} in this checkout`); return m.length ? `no ${m.join(', ')} in this checkout` : false; };

function repo(name, { tag = null, links, settings, adopt = true, dir = code } = {}) {
  const r = path.join(dir, name);
  fs.mkdirSync(r, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: r });
  execFileSync('git', ['remote', 'add', 'origin', `git@github.com:Acme/${name}.git`], { cwd: r });
  const from = tag ? kitAt(tag) : kit;
  fs.cpSync(from, path.join(r, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(from.length)) });
  if (!adopt) return r;
  const i = dtIn(r, ['init', '--name', name]);
  assert.equal(i.status, 0, i.stderr);
  if (links || settings) {
    const f = path.join(r, 'docs/devteam/project/settings.md');
    const s = fs.readFileSync(f, 'utf8');
    const m = /```json devteam\s*\n([\s\S]*?)\n```/.exec(s);
    fs.writeFileSync(f, s.replace(m[1], JSON.stringify({ ...JSON.parse(m[1]), ...settings, ...(links ? { links } : {}) }, null, 2)));
  }
  execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init'], { cwd: r });
  return r;
}
const link = (name) => ({ kind: 'repo', remote: `https://github.com/acme/${name}`, title: name });
const SID = '11111111-2222-3333-4444-555555555555';
// the supervisor's conversation, where Claude Code keeps it
const conversation = (r) => write(path.join(home, '.claude/projects', r.replace(/[^a-zA-Z0-9]/g, '-'), `${SID}.jsonl`), `${JSON.stringify({ type: 'user', message: { content: 'You are the supervisor for this repository' } })}\n`);
const claudeCalls = (r) => (fs.existsSync(path.join(r, '.claude-calls')) ? fs.readFileSync(path.join(r, '.claude-calls'), 'utf8').trim().split('\n').filter(Boolean) : []);

// A stand-in agent in a window of its own: it draws one screen after another, the next on each
// Enter, and keeps every key it was sent.
const rule = `\x1b[38;5;244m${'─'.repeat(60)}\x1b[39m`;
// Claude Code draws its prompt as ❯ and a non-breaking space, as on a real pane from a box
const prompt = '❯ ';
const box = (inside) => `the agent's last output\n${rule}\n${inside}\n${rule}\n\x1b[38;5;211mstatus\x1b[39m\n`;
let agents = 0;
function agent({ screens, cwd = nowhere, window = `a${++agents}`, session = 'keep', command = null }) {
  const id = ++agents;
  const sf = path.join(tmp, `screens-${id}.json`);
  const keys = path.join(tmp, `keys-${id}`);
  fs.writeFileSync(sf, JSON.stringify(screens));
  fs.writeFileSync(keys, '');
  const prog = path.join(tmp, `agent-${id}.cjs`);
  fs.writeFileSync(prog, `const fs = require('fs'); const screens = JSON.parse(fs.readFileSync(${JSON.stringify(sf)}, 'utf8')); let i = 0;
const show = () => process.stdout.write('\\x1b[2J\\x1b[H' + screens[Math.min(i, screens.length - 1)].replace(/\\n/g, '\\r\\n'));
show(); process.stdin.setRawMode(true);
process.stdin.on('data', (d) => { fs.appendFileSync(${JSON.stringify(keys)}, d); for (const c of d.toString()) if (c === '\\r') { i++; show(); } });
setInterval(() => {}, 1e6);\n`);
  const pane = tmuxSh(['new-window', '-dP', '-F', '#{pane_id}', '-t', `=${session}:`, '-n', window, '-c', cwd, command ?? `exec ${process.execPath} ${prog}`]).stdout.trim();
  assert.match(pane, /^%\d+$/);
  return { pane, keys: () => fs.readFileSync(keys, 'utf8'), kill: () => tmuxSh(['kill-pane', '-t', pane]) };
}
const shown = (pane, text) => until(() => tmuxSh(['capture-pane', '-p', '-t', pane]).stdout.includes(text), `pane ${pane} drawn`);
const paneState = (pane) => machine(['machine', 'pane-state', pane]).stdout.trim();

// A worker's session env, as a box gives it: its run folder, its home, its role and ticket, the box's
// address, its tmux pane. Pointed at a decoy, it shows whether a test can still write to the fleet.
const workerEnv = (decoy) => ({ DEVTEAM_RUN: path.join(decoy, 'run'), DEVTEAM_HOME: decoy, DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-1', DEVTEAM_FEATURE: 'x', DEVTEAM_SUPERVISOR: '%1', DEVTEAM_PUBLIC_URL: 'https://box.example.com', DEVTEAM_PREVIEWS: '1', TMUX: 'x', TMUX_PANE: '%9' });
const decoyOf = (name) => { const d = fs.mkdtempSync(path.join(tmp, `${name}-`)); fs.mkdirSync(path.join(d, 'run')); return d; };
const filesIn = (d) => fs.readdirSync(d, { recursive: true }).map(String).sort();

test('importing the test helper leaves no session\'s DEVTEAM_* or tmux in the environment, only the harness\'s own knobs', () => {
  const decoy = decoyOf('env-decoy');
  const env = { ...process.env, ...workerEnv(decoy), DEVTEAM_FORK: path.join(decoy, 'fork'), DEVTEAM_TEST_KEEP: '1' };
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('./lib/kit.mjs', import.meta.url).href)}); console.log(JSON.stringify(Object.keys(process.env).filter((k) => /^(DEVTEAM_|TMUX)/.test(k)).sort()))`], { cwd: tmp, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const names = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.deepEqual(names.filter((k) => !HARNESS_ENV.test(k)), ['DEVTEAM_BOX', 'DEVTEAM_CSWAP', 'DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE', 'DEVTEAM_SUPERVISOR_UP', 'TMUX_TMPDIR']);
  for (const k of ['DEVTEAM_FORK', 'DEVTEAM_TEST_KEEP', 'DEVTEAM_CGROUP', 'DEVTEAM_MEMINFO']) assert.ok(names.includes(k), `${k} survives: the harness reads it`);
  assert.deepEqual(filesIn(decoy), ['run']);
});

// The incident, as the supervisor reproduced it: from the kit's checkout, a worker's role and run
// folder and no home, the test that wrote the owner's rule into a live log at 21:46. (A loaded box
// runs that test in minutes, hence the wait.)
test('a worker\'s run folder gets nothing from the incident\'s own test, run as it was: a worker\'s DEVTEAM_RUN, no DEVTEAM_HOME', { skip: !hasTmux, timeout: 960000 }, () => {
  const decoy = fs.mkdtempSync(path.join(tmp, 'run-decoy-'));
  const env = { ...process.env, DEVTEAM_ROLE: 'worker', DEVTEAM_RUN: decoy };
  delete env.DEVTEAM_HOME;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern', 'status says at a glance', 'test/machine.test.mjs'], { cwd: REPO, env, encoding: 'utf8', timeout: 900000 });
  assert.deepEqual(filesIn(decoy), [], 'nothing written in the worker\'s run folder');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^# pass 1$/m);
  assert.match(r.stdout, /^# fail 0$/m);
  const oks = r.stdout.split('\n').filter((l) => /^ok \d+ - /.test(l));
  const ran = oks.filter((l) => / - status says at a glance/.test(l));
  assert.equal(ran.length, 1, 'the incident\'s test ran');
  assert.doesNotMatch(ran[0], /# SKIP/, 'and was not skipped');
  for (const l of oks.filter((x) => !ran.includes(x))) assert.match(l, /# SKIP test name does not match pattern$/, l);
});

// A kit takes DEVTEAM_RUN only inside the home it resolved: a worker's, leaked into another repo's kit
// (a test's fixture, a sibling), is refused by name, never followed into that worker's live log.
const LEAKED = /DEVTEAM_RUN=.* is not inside this kit's home \(.*\): a session's run folder leaked into another repo's kit/;
const runOf = (r) => path.join(r, 'docs', 'devteam', 'run');
const kitOf = (r) => path.join(r, 'docs', 'devteam', 'scripts', 'devteam.mjs');
const dtAt = (r, cwd, args, env = {}) => spawnSync(process.execPath, [kitOf(r), ...args], { cwd, encoding: 'utf8', env: { ...baseEnv, ...env } });
const snapshot = (d) => fs.readdirSync(d, { recursive: true }).map(String).sort().map((f) => { const p = path.join(d, f); return [f, fs.statSync(p).isFile() ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'dir']; });
const OBSERVE = ['observe', '--subject', 'kit', '--kind', 'other', '--detail', 'a run folder check'];
const WORKER = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-1' };
const runFixture = (name) => { const base = fs.mkdtempSync(path.join(tmp, `${name}-`)); return base; };
const seeded = (base, name) => { const r = bareProject(base, name); const ob = dtIn(r, [...OBSERVE.slice(0, -1), 'seed']); assert.equal(ob.status, 0, ob.stderr); return r; };
const logged = (run, text) => fs.readdirSync(path.join(run, 'log')).some((f) => fs.readFileSync(path.join(run, 'log', f), 'utf8').includes(text));

test('a kit refuses a run folder outside its home: a worker\'s DEVTEAM_RUN leaked into a fixture\'s kit writes nothing there, and says why', () => {
  const base = runFixture('run-refused');
  const app = seeded(base, 'app');
  const api = seeded(base, 'app-api');
  const before = snapshot(runOf(api));
  for (const [args, env] of [[['phase', 'spec'], WORKER], [OBSERVE, {}], [['status'], {}], [['log'], {}]]) {
    const r = dtIn(app, args, { DEVTEAM_RUN: runOf(api), ...env });
    assert.notEqual(r.status, 0, `${args[0]} is refused`);
    assert.match(r.stderr, LEAKED, args[0]);
    assert.ok(r.stderr.includes(`DEVTEAM_RUN=${runOf(api)} is not inside this kit's home (${app}): `), `${args[0]} names both, exactly: ${r.stderr}`);
  }
  assert.deepEqual(snapshot(runOf(api)), before, 'not a byte written in the other home\'s run folder');
  // help, and the machine's own commands (they run from anywhere and keep no run folder): never refused
  for (const args of [['help'], ['machine', 'status'], ['operator-thread', 'list']]) assert.doesNotMatch(dtIn(app, args, { DEVTEAM_RUN: runOf(api) }).stderr, LEAKED, args.join(' '));
  // an empty DEVTEAM_RUN is none: from inside the other home's run folder it is not taken for the cwd
  const empty = dtAt(app, runOf(api), [...OBSERVE.slice(0, -1), 'empty run'], { DEVTEAM_RUN: '' });
  assert.equal(empty.status, 0, empty.stderr);
  assert.ok(logged(runOf(app), 'empty run'), 'the line is in the kit\'s own run folder');
});

test('a kit takes a run folder inside its home, however it is reached: its own, a symlink, one not made yet, a worktree\'s, a run folder that is itself a symlink', () => {
  const base = runFixture('run-taken');
  const app = seeded(base, 'app');
  const link = path.join(base, 'run-link');
  fs.symlinkSync(runOf(app), link);
  const later = path.join(app, 'not-made-yet', 'run');
  for (const [i, run] of [runOf(app), link, later, undefined].entries()) {
    const env = run === undefined ? {} : { DEVTEAM_RUN: run };
    const st = dtIn(app, ['status'], env);
    assert.equal(st.status, 0, `${run}: ${st.stderr}`);
    const ob = dtIn(app, [...OBSERVE.slice(0, -1), `taken ${i}`], env);
    assert.equal(ob.status, 0, `${run}: ${ob.stderr}`);
    assert.ok(logged(run ?? runOf(app), `taken ${i}`), `${run}: the line is in that run folder`);
  }
  // a worker in home's own worktree, on home's run folder
  execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init && git worktree add -q ../app-wt -b ticket/x-1'], { cwd: app });
  const wt = path.join(base, 'app-wt');
  for (const args of [['phase', 'spec'], ['status'], [...OBSERVE.slice(0, -1), 'from the worktree']]) {
    const r = dtAt(wt, wt, args, { DEVTEAM_RUN: runOf(app), ...WORKER });
    assert.equal(r.status, 0, `${args[0]}: ${r.stderr}`);
  }
  assert.ok(logged(runOf(app), '"x-1"') && logged(runOf(app), 'from the worktree'), 'the worktree\'s lines are in home\'s run folder');
  // as a hook or rebase --exec runs it there: git has set GIT_DIR to the worktree's own
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: wt, encoding: 'utf8' }).trim();
  const hooked = dtAt(wt, wt, ['status'], { DEVTEAM_RUN: runOf(app), GIT_DIR: gitDir, ...WORKER });
  assert.equal(hooked.status, 0, `with GIT_DIR: ${hooked.stderr}`);
  // a home whose run folder is a symlink out of the checkout
  const ln = seeded(base, 'app-ln');
  const away = path.join(base, 'elsewhere-run');
  fs.renameSync(runOf(ln), away);
  fs.symlinkSync(away, runOf(ln));
  const ob = dtIn(ln, [...OBSERVE.slice(0, -1), 'taken symlinked'], { DEVTEAM_RUN: runOf(ln) });
  assert.equal(ob.status, 0, ob.stderr);
  assert.equal(dtIn(ln, ['status'], { DEVTEAM_RUN: runOf(ln) }).status, 0);
  assert.ok(logged(away, 'taken symlinked'));
});

test('a worker on a repo link keeps every command it uses: cwd in the link\'s worktree, DEVTEAM_HOME and DEVTEAM_RUN home\'s', () => {
  const base = runFixture('run-link');
  const home = seeded(base, 'home');
  const linked = path.join(base, 'linked');
  fs.mkdirSync(linked);
  execFileSync('sh', ['-c', 'git init -q -b main && git remote add origin https://github.com/me/linked.git && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init && git worktree add -q ../linked-wt -b ticket/x-1'], { cwd: linked });
  // home names it a repo link, as settings.md does for the kit's own repo in devteam-dev
  const settings = path.join(home, 'docs/devteam/project/settings.md');
  const txt = fs.readFileSync(settings, 'utf8');
  const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  const j = JSON.parse(m[1]);
  j.links = { ...j.links, linked: { kind: 'repo', title: 'Linked', remote: 'me/linked', path: linked } };
  fs.writeFileSync(settings, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
  const wt = path.join(base, 'linked-wt');
  assert.match(dtAt(home, wt, ['whoami'], { DEVTEAM_HOME: home, DEVTEAM_RUN: runOf(home), ...WORKER }).stdout, /repo=/, 'the link worker\'s whoami');
  const env = { DEVTEAM_HOME: home, DEVTEAM_RUN: runOf(home), ...WORKER };
  const run = (args) => dtAt(home, wt, args, env);
  for (const args of [['phase', 'build', '--task', 'T1'], ['send', 'supervisor', 'a link worker\'s line', '--kind', 'info'], ['gate', 'test', '--', process.execPath, '-e', '0'], ['send', 'supervisor', 'x-1 ready to merge', '--kind', 'merge-request'], ['whoami']]) {
    const r = run(args);
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
  }
  // check-ticket judges the ticket (there is none here), never the run folder
  const ct = run(['check-ticket', 'x-1']);
  assert.doesNotMatch(ct.stderr, LEAKED);
  for (const said of ['"type":"phase"', 'a link worker\'s line', 'x-1 ready to merge', '"type":"gate"']) assert.ok(logged(runOf(home), said), `${said} is in home's run folder`);
});

test('a kit copied into a home\'s tree without a repo of its own refuses to run against that home', () => {
  const base = runFixture('run-nested');
  const home = seeded(base, 'home');
  const plain = path.join(home, 'fixtures', 'plain');
  const copy = (to) => fs.cpSync(kit, to, { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  copy(path.join(plain, 'docs', 'devteam'));
  // a copy kept anywhere but a checkout's own docs/devteam, here three folders below home's .git
  const vendor = path.join(home, 'vendor', 'kit');
  copy(vendor);
  const v = spawnSync(process.execPath, [path.join(vendor, 'scripts', 'devteam.mjs'), 'status'], { cwd: home, encoding: 'utf8', env: baseEnv });
  assert.notEqual(v.status, 0, 'a vendored copy');
  assert.match(v.stderr, /is not its checkout's own/);
  const before = snapshot(runOf(home));
  const refused = () => { for (const args of [['status'], OBSERVE]) {
    const r = dtAt(plain, plain, args);
    assert.notEqual(r.status, 0, args[0]);
    assert.match(r.stderr, /is not its checkout's own .*: a copy inside another repo can't run against that repo's home/, args[0]);
  } };
  refused();
  // a copy that differs from home's kit would otherwise hand the command to home's own kit
  fs.appendFileSync(kitOf(plain), '\n// a copy, changed\n');
  refused();
  // nor does a .git that is no repo of its own make it one
  fs.mkdirSync(path.join(plain, '.git'));
  refused();
  assert.deepEqual(snapshot(runOf(home)), before, 'home\'s run folder is untouched');
});

test('what a pane is at, from what is on it', { skip: !hasTmux }, async () => {
  const at = async (screen, want, why) => { const a = agent({ screens: [screen] }); await shown(a.pane, screen.replace(/\x1b\[[0-9;]*m/g, '').split('\n').find((l) => l.trim()).replace(/ /g, ' ').trim().slice(0, 12)); assert.equal(paneState(a.pane), want, why); a.kill(); };
  await at(box(`\x1b[38;5;246m${prompt}\x1b[39m`), 'ready', 'an empty input, with the real non-breaking space');
  await at(box(`\x1b[39m${prompt}\x1b[2mcopy the .env.local files\x1b[0m`), 'ready', 'a dim suggestion is the harness\'s, not typing');
  await at(box(`${prompt}fix the `), 'typing', 'text in the input box is someone\'s');
  await at(box(`${prompt}fix the \x1b[2mbug\x1b[0m`), 'typing', 'typed text with a suggestion after it is still typing');
  await at('Do you trust the files in this folder?\n❯ 1. Yes, I trust\n', 'dialog');
  await at('Quick safety check: Is this a project you created or one you trust?\n ❯ Yes, I trust this folder\n   No, exit\n', 'dialog', 'the real trust dialog');
  await at(`Do you want to proceed?\n❯ 1. Yes\n  2. No\n${rule}\n`, 'dialog', 'a menu is a dialog, however it is drawn');
  await at(`You've hit your limit · resets 3pm\n${box(prompt)}`, 'limit', 'the banner the kit knows');
  await at(`Claude usage limit reached\n${box(prompt)}`, 'limit');
  await at(`5-hour limit reached ∙ resets 9am\n${box(prompt)}`, 'limit');
  // what the agent wrote about, never its own UI: none of these may hold a tick
  await at(`The stacks supervisor's usage limit reached its reset.\n${box(prompt)}`, 'ready', 'prose naming a limit');
  await at(`> You've hit your limit · resets 3pm\n${box(prompt)}`, 'ready', 'a quoted banner');
  await at(`Do you want to run the migration next?\n${box(prompt)}`, 'ready', 'a question it asked, with its input box up');
  await at(`Press Enter to continue is what the dialog says.\n${box(prompt)}`, 'ready');
  await at(`✢ Thinking… (esc to interrupt)\n${box(prompt)}`, 'busy');
  await at('a screen with no input box', 'unknown');
  // with no input box drawn, a dialog's words count only where the harness puts them
  await at('I asked whether do you want to keep it is right', 'unknown', 'prose mid-line is not a dialog');
  await at('the [y/n] prompts are in the docs', 'unknown', 'nor a y/n that isn\'t at the end');
  await at('Overwrite config/master.key? [y/n] ', 'dialog');
  await at('Press Enter to continue…', 'dialog');
  const sh = tmuxSh(['new-window', '-dP', '-F', '#{pane_id}', '-t', '=keep:', '-n', 'a-shell']).stdout.trim();
  await until(() => paneState(sh) === 'shell', 'a shell');
  const other = tmuxSh(['new-window', '-dP', '-F', '#{pane_id}', '-t', '=keep:', '-n', 'other', 'exec sleep 3600']).stdout.trim();
  assert.equal(paneState(other), 'other', 'never type into vim, psql or any other program');
  tmuxSh(['kill-pane', '-t', other]);
  tmuxSh(['kill-pane', '-t', sh]);
  assert.equal(paneState(other), 'gone');
  assert.equal(machine(['machine', 'pane-state']).status, 2);
});

test('tell types into a supervisor, marked as not the owner, and only when its pane can take it', { skip: !hasTmux }, async () => {
  const r = repo('tellable');
  const told = (args = ['hello'], env = {}) => machine(['machine', 'tell', '--in', code, '--', 'tellable', ...args], env);
  const sup = agent({ screens: [box(prompt)], cwd: r, window: 'sup-tellable' });
  await shown(sup.pane, 'status');
  const ok = told(['disk is low\non this box', '--force']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, new RegExp(`^tellable: told \\(pane ${sup.pane}\\)`));
  await until(() => sup.keys().includes('\r'), 'the Enter');
  assert.equal(sup.keys(), "From the operator (information, not an owner answer; record nothing as the owner's from this): disk is low on this box --force\r", 'one line, prefixed, its words whatever they start with');
  // never into the pane this runs in, and never from a session in a fleet
  assert.match(told(['hi'], { TMUX_PANE: sup.pane }).stdout, /not told: no supervisor is up in its root/);
  for (const role of ['supervisor', 'worker', 'planner']) { const x = told(['hi'], { DEVTEAM_ROLE: role }); assert.notEqual(x.status, 0, role); assert.match(x.stderr, /the operator's or the owner's/, role); }
  assert.equal(told(['hi'], { DEVTEAM_ROLE: 'operator' }).status, 0, 'the operator\'s own');
  assert.equal(sup.keys().split('\r').length, 3, 'nothing typed for those refused');
  sup.kill();

  const typing = agent({ screens: [box(`${prompt}half a thou`)], cwd: r, window: 'sup-tellable' });
  await shown(typing.pane, 'half a thou');
  const busyInput = told();
  assert.equal(busyInput.status, 3);
  assert.match(busyInput.stdout, /not told: its pane is at typing/);
  assert.equal(typing.keys(), '', 'nothing typed over someone\'s line');
  typing.kill();

  // a lost Enter: the line is still in the input, one more Enter takes it
  const lost = agent({ screens: [box(prompt), box(`${prompt}From the operator (information`), box(prompt)], cwd: r, window: 'sup-tellable' });
  await shown(lost.pane, 'status');
  assert.match(told().stdout, /told \(pane/);
  assert.equal(lost.keys().split('\r').length - 1, 2, 'one more Enter, and only one');
  lost.kill();
  // still there after that: said, never reported as told
  const stuck = agent({ screens: [box(prompt), box(`${prompt}From the operator (information`)], cwd: r, window: 'sup-tellable' });
  await shown(stuck.pane, 'status');
  const notDelivered = told();
  assert.equal(notDelivered.status, 3);
  assert.match(notDelivered.stdout, /not delivered: the message is still in its input/);
  assert.equal(stuck.keys().split('\r').length - 1, 3, 'pressed three times in all before saying so');
  stuck.kill();

  // the operator's window, the owner's shell window, and a pane started elsewhere are never it
  for (const [window, cwd] of [['operator', r], ['shell', r], ['sup-tellable', path.join(tmp, 'elsewhere')]]) {
    fs.mkdirSync(cwd, { recursive: true });
    const a = agent({ screens: [box(prompt)], cwd, window });
    await shown(a.pane, 'status');
    const x = told();
    assert.equal(x.status, 3, window);
    assert.match(x.stdout, /no supervisor is up in its root/, window);
    assert.equal(a.keys(), '', window);
    a.kill();
  }
  const dialog = agent({ screens: ['Do you want to proceed?\n❯ 1. Yes\n'], cwd: r, window: 'sup-tellable' });
  await shown(dialog.pane, 'proceed');
  assert.match(told().stdout, /not told: its pane is at dialog/);
  assert.equal(dialog.keys(), '');
  dialog.kill();
  const nobody = told();
  assert.equal(nobody.status, 3);
  assert.match(nobody.stdout, /no supervisor is up/);
  assert.equal(machine(['machine', 'tell', '--in', code, '--', 'not-here', 'hello']).status, 1);
  assert.equal(machine(['machine', 'tell', '--in', code, '--', '../etc', 'hello']).status, 2, 'a repo is a name, never a path');
  assert.equal(machine(['machine', 'tell', '--in', code, '--', 'tellable']).status, 2, 'no message');
});

test('tell and status find a project the machine recorded, outside any --in folder', { skip: !hasTmux }, async () => {
  const away = path.join(tmp, 'elsewhere-projects');
  const r = repo('recorded', { dir: away });
  // what a dashboard's tick or the supervisor's own command leaves (registerOnMachine)
  write(path.join(home, '.devteam', `repos-${process.env.DEVTEAM_HUB_PORT}`, 'recorded.json'), JSON.stringify({ root: r, at: new Date().toISOString() }));
  const sup = agent({ screens: [box(prompt)], cwd: r, window: 'sup-recorded' });
  try {
    await shown(sup.pane, 'status');
    const x = machine(['machine', 'tell', 'recorded', 'hello']);
    assert.equal(x.status, 0, x.stdout + x.stderr);
    assert.match(machine(['machine', 'status']).stdout, new RegExp(`^recorded sup=up .* pane=${sup.pane} state=ready`, 'm'));
  } finally { sup.kill(); fs.rmSync(path.join(home, '.devteam', `repos-${process.env.DEVTEAM_HUB_PORT}`, 'recorded.json')); }
});

test('alert reaches the hub, by hello, and clears', () => {
  const r = repo('alerted');
  const alert = path.join(home, '.box/alert');
  const raise = (...w) => machine(['machine', 'alert', '--', ...w]);
  fs.rmSync(alert, { force: true });
  assert.equal(JSON.parse(dtIn(r, ['hello', '--json']).stdout).alert, undefined);
  assert.match(raise('disk\nnearly full').stdout, /alert raised: disk nearly full/);
  assert.equal(JSON.parse(dtIn(r, ['hello', '--json']).stdout).alert, 'disk nearly full');
  fs.utimesSync(alert, new Date(Date.now() - 25 * 3600000), new Date(Date.now() - 25 * 3600000));
  assert.equal(JSON.parse(dtIn(r, ['hello', '--json']).stdout).alert, undefined, 'a day old, it has been seen or forgotten');
  raise(`${'x'.repeat(199)}é and more`);
  assert.equal(fs.readFileSync(alert, 'utf8'), `${'x'.repeat(199)}\n`, 'cut at 200 bytes, never half a character');
  raise(`${'x'.repeat(198)}€ and more`);
  assert.equal(fs.readFileSync(alert, 'utf8'), `${'x'.repeat(198)}\n`, 'nor a third of one');
  raise(`${'x'.repeat(198)}é and more`);
  assert.equal(fs.readFileSync(alert, 'utf8'), `${'x'.repeat(198)}é\n`, 'a whole character that fits stays');
  raise('short é');
  assert.equal(fs.readFileSync(alert, 'utf8'), 'short é\n', 'and a line under the limit is left alone');
  const fromWorker = machine(['machine', 'alert', '--', 'not mine'], { DEVTEAM_ROLE: 'worker' });
  assert.notEqual(fromWorker.status, 0);
  assert.equal(fs.readFileSync(alert, 'utf8'), 'short é\n', 'the operator\'s, never a worker\'s');
  assert.match(raise('--clear').stdout, /alert cleared/);
  assert.ok(!fs.existsSync(alert));
  assert.equal(raise().status, 2);
});

test('status says at a glance what a check-in needs, and reads no pane it needn\'t', { skip: !hasTmux }, async () => {
  const notes = path.join(home, 'operator/NOTES.md');
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.rmSync(path.join(home, '.box/alert'), { force: true });
  const last = path.join(home, '.devteam', `status-last-${process.env.DEVTEAM_HUB_PORT}`);
  fs.rmSync(last, { force: true });
  const sub = path.join(tmp, 'status-code');
  const r = repo('statused', { settings: { upstream_base: 'v0.1.0', worktree_files: ['config/master.key'] }, dir: sub });
  const sib = repo('a-sib', { dir: sub });
  repo('the-home', { links: { 'a-sib': link('a-sib') }, dir: sub });
  const sup = { DEVTEAM_ROLE: 'supervisor', DEVTEAM_SUPERVISOR_UP: 'off' };
  const q1 = dtIn(r, ['ask', '--question', 'first?', '--kind', 'owner-decision', '--class', 'design', '--reasons', 'x'], sup);
  assert.equal(q1.status, 0, q1.stderr + q1.stdout);
  assert.equal(dtIn(r, ['ask', '--question', 'second?', '--kind', 'owner-decision', '--class', 'design', '--reasons', 'x'], sup).status, 0);
  // knowledge to harvest: the owner's rule, a lesson the supervisor tagged for the kit, one already noted, one still a candidate
  const rule = dtIn(r, ['knowledge', 'add', '--kind', 'preference', '--statement', 'Ship banners without asking', '--owner']).stdout.trim();
  const ob = dtIn(r, ['observe', '--subject', 'kit', '--kind', 'friction', '--detail', 'd', '--severity', '1', '--valence', '-1'], sup).stdout.trim();
  const kitL = dtIn(r, ['knowledge', 'add', '--kind', 'lesson', '--statement', 'Fetch before the merge', '--evidence', ob, '--kit'], sup).stdout.trim();
  const seenL = dtIn(r, ['knowledge', 'add', '--kind', 'fact', '--statement', 'Seen already', '--evidence', ob], sup).stdout.trim();
  dtIn(r, ['knowledge', 'add', '--kind', 'fact', '--statement', 'Still a candidate'], sup);
  for (const k of [kitL, seenL]) assert.equal(dtIn(r, ['knowledge', 'set', k, '--status', 'accepted'], sup).status, 0);
  fs.writeFileSync(notes, `read ${q1.stdout.trim()}\n- ${seenL}: stays\nfriction: same as ${kitL}, in passing\n`);
  fs.mkdirSync(path.join(r, '.worktrees/a/node_modules'), { recursive: true });
  fs.writeFileSync(path.join(r, '.worktrees/a/node_modules/big'), Buffer.alloc(4096 * 256));
  fs.writeFileSync(path.join(r, 'docs/devteam/run/accounts.json'), JSON.stringify({ at: new Date().toISOString(), cswap: true, active: 'a@b', active_no_room: false, exhausted: false, needs_login: ['c@d'], restart_gave_up: [], supervisor_limit: null }));
  // tmux, as the kit sees it, noting what it was asked
  const logged = path.join(tmp, 'tmux-asked');
  const spy = path.join(tmp, 'spy');
  write(path.join(spy, 'tmux'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(logged)}\nPATH=${JSON.stringify(process.env.PATH)} exec tmux "$@"\n`);
  fs.chmodSync(path.join(spy, 'tmux'), 0o755);
  const srv = spawn(process.execPath, ['-e', "require('http').createServer((q, r) => r.end('ok')).listen(0, '127.0.0.1', function () { console.log(this.address().port); });"], { stdio: ['ignore', 'pipe', 'inherit'] });
  const portUp = await new Promise((ok) => srv.stdout.once('data', (d) => ok(Number(String(d).trim()))));
  const worker = path.join(tmp, 'statused-wt');
  fs.mkdirSync(worker, { recursive: true });
  const a = agent({ screens: [box(prompt)], cwd: r, window: 'sup-statused' });
  const shell = agent({ screens: ['secret in the owner\'s shell'], cwd: home, window: 'shell' });
  const x = agent({ screens: [`line\n${box(prompt)}`, `other output now\n${box(prompt)}`], cwd: worker, window: 'worker-x' });
  const y = agent({ screens: [`You've hit your limit · resets 3pm\n${box(prompt)}`], cwd: worker, window: 'worker-y' });
  const status = (args = [], env = {}) => machine(['machine', 'status', '--in', sub, '--notes', notes, ...args], { PATH: `${spy}${path.delimiter}${baseEnv.PATH}`, ...env });
  try {
    for (const p of [a, x, y]) await shown(p.pane, 'status');
    fs.writeFileSync(path.join(r, 'docs/devteam/run/dashboard-port'), `${portUp}\n`);
    fs.writeFileSync(logged, '');
    const st = status([], { DEVTEAM_STATUS_SECONDS: '0' });
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /^machine: disk \S+ free of \S+.*; memory .*; cpus \S+.*; load [\d.]+ [\d.]+ [\d.]+$/m);
    assert.match(st.stdout, /^machine: accounts cswap active=a@b exhausted=false no-room=false needs-login=c@d as of /m);
    assert.match(st.stdout, new RegExp(`^machine: hub ${process.env.DEVTEAM_HUB_PORT} DOWN$`, 'm'));
    assert.match(st.stdout, new RegExp(`^statused sup=up fleet=run kit=v0\\.1\\.0\\S* inbox=\\d+ missing=config/master\\.key tools=ok behind=v9\\.9\\.9 pane=${a.pane} state=ready dash=${portUp}/up wt=1/\\S+ new-questions=1 new-knowledge=2$`, 'm'));
    assert.match(st.stdout, /^machine: daily review due \(last never\)$/m);
    const kn = status(['--knowledge']);
    assert.equal(kn.status, 0, kn.stderr);
    assert.match(kn.stdout, new RegExp(`^statused ${rule} \\[preference, project, owner's\\] Ship banners without asking$`, 'm'));
    assert.match(kn.stdout, new RegExp(`^statused ${kitL} \\[lesson, project, kit lesson\\] Fetch before the merge$`, 'm'));
    assert.doesNotMatch(kn.stdout, /Seen already|Still a candidate/, 'noted, or not accepted: not listed');
    // the review is done for the day once the notes have today's heading; an older one leaves it due
    fs.appendFileSync(notes, '\n## Review 2026-01-02\n');
    assert.match(status().stdout, /^machine: daily review due \(last 2026-01-02\)$/m);
    const today = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(notes, `\n## Review ${today} (UTC)\n1. **${rule}**: the owner's ruling, stays\n`);
    assert.match(status().stdout, new RegExp(`^machine: daily review done ${today}$`, 'm'));
    assert.match(status().stdout, /^statused .* new-knowledge=1$/m);
    assert.match(st.stdout, /^a-sib sup=down .* sibling-of=the-home$/m);
    assert.match(st.stdout, new RegExp(`^attention: ${y.pane} keep:worker-y limit$`, 'm'));
    assert.doesNotMatch(st.stdout, new RegExp(`${shell.pane}\\b`), 'never the owner\'s shell');
    assert.doesNotMatch(fs.readFileSync(logged, 'utf8'), new RegExp(`capture-pane .*-t ${shell.pane}$`, 'm'), 'not even read');
    assert.match(st.stdout, new RegExp(`^changed since last reading: .*${a.pane}.*${x.pane}.*${y.pane}`, 'm'), 'no reading before: everything changed');
    const q = status(['--questions']);
    assert.match(q.stdout, /^statused q-\S+ \[owner-decision\] second\?$/m);
    assert.doesNotMatch(q.stdout, /first\?/, 'noted, so not read again');
    assert.match(fs.readFileSync(last, 'utf8'), /^at \d+\ndisk \d+\npane %\d+ \w+\n/, 'the reading it keeps');
    // only what moved: one pane's screen changes
    tmuxSh(['send-keys', '-t', x.pane, 'Enter']);
    await shown(x.pane, 'other output now');
    assert.match(status([], { DEVTEAM_STATUS_SECONDS: '0' }).stdout, new RegExp(`^changed since last reading: ${x.pane}$`, 'm'));
    assert.match(status([], { DEVTEAM_STATUS_SECONDS: '0' }).stdout, /^changed since last reading: $/m, 'nothing moved since: nothing changed');
    // the reading is held 20 minutes, so a manual re-run doesn't erase the change the next check-in should see
    const held = fs.readFileSync(last, 'utf8');
    status();
    assert.equal(fs.readFileSync(last, 'utf8'), held);
    // a dashboard's port nothing answers is down; a repo whose kit is at the latest isn't behind
    fs.writeFileSync(path.join(r, 'docs/devteam/run/dashboard-port'), '9\n');
    fs.writeFileSync(latestRelease, 'v0.1.0\n');
    const st3 = status();
    assert.match(st3.stdout, /^statused .*dash=9\/DOWN/m);
    assert.doesNotMatch(st3.stdout, /behind=/);
    machine(['machine', 'alert', '--', 'look at the disk']);
    assert.match(status().stdout, /^machine: hub \d+ DOWN; alert: look at the disk$/m);
    machine(['machine', 'alert', '--', '--clear']);
    assert.ok(!fs.existsSync(path.join(r, 'docs/devteam/run/supervisor-pane')), 'reading a project writes nothing of its');
  } finally {
    srv.kill();
    for (const p of [a, shell, x, y]) p.kill();
    fs.writeFileSync(latestRelease, 'v9.9.9\n');

  }
});

test('status says the machine\'s own CPU and memory caps, not the host\'s', () => {
  // a 2-CPU, 8 GiB container: 6 GiB charged, 2 GiB of it page cache the kernel can drop
  const cg = fs.mkdtempSync(path.join(tmp, 'cgroup-'));
  const G = 1024 ** 3;
  fs.writeFileSync(path.join(cg, 'cpu.max'), '200000 100000\n');
  fs.writeFileSync(path.join(cg, 'cpu.pressure'), 'some avg10=20.00 avg60=15.00 avg300=10.00 total=1\nfull avg10=14.00 avg60=12.60 avg300=9.00 total=1\n');
  fs.writeFileSync(path.join(cg, 'memory.max'), `${8 * G}\n`);
  fs.writeFileSync(path.join(cg, 'memory.current'), `${6 * G}\n`);
  fs.writeFileSync(path.join(cg, 'memory.stat'), `anon ${3 * G}\nfile ${2 * G}\n`);
  const r = machine(['machine', 'status'], { DEVTEAM_CGROUP: cg });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^machine: disk .*; memory 4\.0 GB in use of 8\.0 GB; cpus 2 \(all waiting 13% of the last minute\); load /m);
  // no caps (a laptop, or a cgroup that says max): the machine's own numbers
  fs.writeFileSync(path.join(cg, 'cpu.max'), 'max 100000\n');
  fs.writeFileSync(path.join(cg, 'memory.max'), 'max\n');
  assert.match(machine(['machine', 'status'], { DEVTEAM_CGROUP: cg }).stdout, /^machine: disk .*; memory [\d.]+ GB free of [\d.]+ GB; cpus \d+[ ;].*load /m);
  // the host's own: MemAvailable of MemTotal (what the kit's memory ceiling reads too)
  const meminfo = path.join(cg, 'meminfo');
  fs.writeFileSync(meminfo, 'MemTotal:       8388608 kB\nMemFree:          524288 kB\nMemAvailable:    3145728 kB\n');
  assert.match(machine(['machine', 'status'], { DEVTEAM_CGROUP: cg, DEVTEAM_MEMINFO: meminfo }).stdout, /^machine: disk .*; memory 3\.0 GB free of 8\.0 GB; cpus /m);
});

// Every read the operator is allowed, against a repo with something in it: the log, git status and
// the files on disk are byte-for-byte what they were. That's the point of the list.
test('each read the operator may run writes nothing', () => {
  const r = repo('read-only', { settings: { upstream_base: 'v0.2.0', sensors: { web: { kind: 'http', url: 'https://app.example.test/up' } } } });
  const sup = { DEVTEAM_ROLE: 'supervisor', DEVTEAM_SUPERVISOR_UP: 'off' };
  assert.equal(dtIn(r, ['goal', 'add', '--title', 'a goal', '--outcome', 'x'], sup).status, 0);
  const goal = dtIn(r, ['goal'], sup).stdout.match(/g-\S+/)?.[0];
  assert.ok(goal);
  const k = dtIn(r, ['knowledge', 'add', '--kind', 'fact', '--statement', 's'], sup).stdout.match(/k-\S+/)?.[0];
  assert.ok(k);
  assert.equal(dtIn(r, ['ask', '--question', 'q?', '--kind', 'owner-decision', '--class', 'design', '--reasons', 'x'], sup).status, 0);
  assert.equal(dtIn(r, ['send', 'supervisor', 'hello'], sup).status, 0);
  const p = dtIn(r, ['problem', 'add', '--title', 'a problem', '--severity', '2'], sup).stdout.trim();
  assert.match(p, /^p-/);
  conversation(r);
  const op = { DEVTEAM_ROLE: 'operator', TMUX: 'x', TMUX_PANE: '%7' };
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.name === '.git') continue; if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };
  const snap = () => ({ files: Object.fromEntries(walk(r).map((f) => [f, fs.readFileSync(f).toString('base64')])), status: execFileSync('git', ['status', '--porcelain'], { cwd: r, encoding: 'utf8' }) });
  const before = snap();
  const reads = [['search', 'goal'], ['status'], ['status', '--json'], ['ready'], ['ready', '--json'], ['metrics'], ['metrics', '--json'], ['hello', '--json'], ['settings'], ['supervisor-session'], ['prompt', 'supervisor'], ['validate'], ['questions'], ['questions', '--json', '--all'], ['log', '--json', '--tail', '5'], ['messages', '--to', 'supervisor', '--open'], ['knowledge', '--json'], ['knowledge', '--for', 'x'], ['goal', '--json'], ['goal', 'list'], ['goal', 'show', goal], ['fleet', 'status', '--json', '--no-fetch'], ['trust'], ['trust', '--json'], ['problem'], ['problem', '--json', '--all'], ['sensor', 'status'], ['sensor', 'status', '--json'], ['sensor', 'series', 'web', '--range', '7d'], ['knowledge', '--kit'], ['machine', 'pane-state', '%7'], ['peek', 'lesson', k, '--json'], ['peek', 'lesson', k, '--mermaid'], ['peek', 'problem', p, '--json'], ['peek', 'goal', goal, '--json'], ['peek', 'sensor', 'web', '--json']];
  for (const c of reads) { const x = dtIn(r, c, op); assert.equal(x.status, 0, `${c.join(' ')}: ${x.stderr}`); assert.doesNotMatch(x.stderr, /only reads/, c.join(' ')); }
  // and the machine's digest, run from inside the project, reads it the same way
  assert.equal(dtIn(r, ['machine', 'status', '--in', code], op).status, 0);
  const after = snap();
  assert.deepEqual(Object.keys(after.files).sort(), Object.keys(before.files).sort(), 'no file created or removed');
  for (const f of Object.keys(before.files)) assert.equal(after.files[f], before.files[f], `${f} unchanged`);
  assert.equal(after.status, before.status);
});

test('the kit lets a box operator look, and nothing else', () => {
  const r = repo('guarded');
  const op = { DEVTEAM_ROLE: 'operator', TMUX: 'x', TMUX_PANE: '%7' };
  for (const c of [['status'], ['fleet', 'status', '--json', '--no-fetch'], ['settings', '--get', 'main_branch'], ['supervisor-session'], ['questions', '--json'], ['log', '--json'], ['messages', '--to', 'supervisor', '--open'], ['knowledge'], ['knowledge', '--kind', 'fact'], ['goal'], ['goal', 'list']]) assert.equal(dtIn(r, c, op).status, 0, c.join(' '));
  for (const c of [['merge', 't-1'], ['fleet', 'park', '--reason', 'x'], ['fleet', 'unpark'], ['answer', 'q', 'yes'], ['send', 'supervisor', 'hi'], ['knowledge', 'add', '--kind', 'fact', '--statement', 'x'], ['knowledge', 'set', 'k-1'], ['goal', 'add', '--title', 'x'], ['goal', 'set', 'g-1'], ['goal', 'status', 'g-1', 'met'], ['goal', 'hold', 'g-1', 'park'], ['goal', 'reading', 'g-1', '--run'], ['ticket', 'show', 't-1'], ['dashboard-data'], ['ask', '--question', 'q', '--kind', 'x'], ['problem', 'add', '--title', 'x', '--severity', '1'], ['problem', 'set', 'p-1', '--status', 'resolved'], ['sensor', 'poll'], ['sensor', 'test', 'web'], ['sensor', 'ignore', 'f-1', '--reason', 'x'], ['sensor', 'discover'], ['knowledge', 'set', 'k-1', '--kit']]) { const x = dtIn(r, c, op); assert.notEqual(x.status, 0, c.join(' ')); assert.match(x.stderr, /only reads|owner commands/, c.join(' ')); }
  assert.ok(!fs.existsSync(path.join(r, 'docs/devteam/run/supervisor-pane')), 'and it is never taken for the supervisor\'s pane');
  // the one write the operator has: bringing a supervisor back (operator.md)
  const dry = dtIn(r, ['recover', '--dry-run'], op);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /left stopped/);
  const worker = dtIn(r, ['recover', '--dry-run'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-1' });
  assert.notEqual(worker.status, 0);
  assert.match(worker.stderr, /recover: /);
});

// recover --machine as the box runs it: box-recover's flags, a box's own folder of repos and its list.
const boxCode = path.join(tmp, 'box-code');
const upList = path.join(home, '.devteam-supervisors.boot');
const boxRecover = (args = [], env = {}) => machine(['recover', '--machine', '--in', boxCode, '--session', 'home', '--was-up', upList, ...args], { DEVTEAM_ROLE: 'operator', ...env });
const listLine = (r, ago = 60) => `${Math.floor(Date.now() / 1000) - ago} ${r}\n`;
const homeSession = () => { tmuxSh(['kill-session', '-t', '=home']); execFileSync('tmux', ['new-session', '-d', '-s', 'home', '-n', 'operator', '-x', '200', '-y', '50', 'sleep 86400'], { env: baseEnv }); };
const windowsIn = (s) => (tmuxSh(['list-windows', '-t', `=${s}`, '-F', '#W']).stdout ?? '').split('\n').filter(Boolean);

test('a repo on a kit from before recover comes back from the box\'s list, the way the box always brought it back', { skip: !hasTmux || skipOld() }, async () => {
  homeSession();
  const old = Object.fromEntries(OLD.map((tag) => [tag, repo(`old-${tag.replace(/\./g, '-')}`, { tag, dir: boxCode, settings: tag === 'v0.25.0' ? { worktree_files: ['config/master.key'] } : {} })]));
  for (const r of Object.values(old)) { conversation(r); assert.ok(!/recover: cmdRecover/.test(fs.readFileSync(path.join(r, 'docs/devteam/scripts/devteam.mjs'), 'utf8')), 'a kit from before recover'); }
  const fresh = repo('old-fresh', { tag: 'v0.28.0', dir: boxCode });
  const parked = repo('old-parked', { tag: 'v0.30.0', dir: boxCode });
  assert.equal(dtIn(parked, ['fleet', 'park', '--reason', 'moving'], { DEVTEAM_ROLE: 'supervisor' }).status, 0);
  const unlisted = repo('old-unlisted', { tag: 'v0.25.0', dir: boxCode });
  repo('old-kit-only', { tag: 'v0.25.0', dir: boxCode, adopt: false });
  // an entry first listed 4 days ago says nothing any more, though the file is minutes old
  const stale = repo('old-stale', { tag: 'v0.25.0', dir: boxCode });
  fs.writeFileSync(upList, [...Object.values(old), fresh, parked].map((r) => listLine(r)).join('') + listLine(stale, 4 * 86400));
  try {
    const dry = boxRecover(['--dry-run']);
    assert.equal(dry.status, 0, dry.stderr);
    const said = lines(dry);
    for (const tag of OLD) assert.match(said[`old-${tag.replace(/\./g, '-')}`], new RegExp(`^would resume session ${SID}`), tag);
    assert.match(said['old-v0-25-0'], /\(missing here: config\/master\.key\)/);
    assert.match(said['old-fresh'], /^would start fresh/, 'no conversation to resume');
    assert.match(said['old-parked'], /^left stopped \(its fleet is held: park\)/);
    assert.match(said['old-unlisted'], /^left stopped \(not running before the restart; --force starts it\)/);
    assert.match(said['old-stale'], /^left stopped \(not running before/);
    assert.equal(said['old-kit-only'], undefined, 'the kit without settings is not adopted');
    assert.deepEqual(windowsIn('home'), ['operator'], 'a dry run opens nothing');

    const did = boxRecover();
    assert.equal(did.status, 0, did.stderr + did.stdout);
    const real = lines(did);
    for (const tag of OLD) assert.match(real[`old-${tag.replace(/\./g, '-')}`], new RegExp(`^resumed session ${SID}`), tag);
    assert.match(real['old-v0-25-0'], /asked to get: config\/master\.key/);
    assert.match(real['old-fresh'], /^started fresh/);
    for (const r of [...Object.values(old), fresh]) await until(() => claudeCalls(r).length === 1, `${path.basename(r)}'s supervisor ran`);
    for (const r of Object.values(old)) {
      assert.match(claudeCalls(r)[0], new RegExp(`^supervisor\\|--resume ${SID} --dangerously-skip-permissions The box restarted`), 'its own resume_command, on its own conversation, as the supervisor');
      assert.match(claudeCalls(r)[0], /Nothing about this restart came from the owner/);
      assert.match(fs.readFileSync(path.join(r, 'docs/devteam/run/supervisor-pane'), 'utf8'), /^%\d+$/);
      assert.ok(!fs.existsSync(path.join(r, 'docs/devteam/run/supervisor-pane-role')), 'only what its own kit writes: a file it doesn\'t know would hold a move (fleet status)');
      const st = dtIn(r, ['fleet', 'status', '--json', '--no-fetch']);
      assert.equal(st.status, 0, st.stderr);
      assert.ok(!JSON.parse(st.stdout).blockers.some((b) => /didn't make/.test(b)), `its own kit's fleet status: ${st.stdout}`);
    }
    assert.match(fs.readFileSync(path.join(old['v0.25.0'], 'docs/devteam/run/supervisor-prompt.txt'), 'utf8'), /missing: config\/master\.key.*Inbox.*--secrets.*file:<path>/s);
    assert.match(claudeCalls(fresh)[0], /^supervisor\|--dangerously-skip-permissions .*supervisor/, 'its agent_command, with its own kit\'s prompt');
    assert.deepEqual(windowsIn('home').sort(), ['operator', 'sup-old-fresh', 'sup-old-v0-25-0', 'sup-old-v0-28-0', 'sup-old-v0-30-0']);
    assert.ok(!fs.existsSync(upList), 'the list is used up once they are back, the stale entry with it');

    // safe to run twice: each is up, so none gets a second, list or --force
    fs.writeFileSync(upList, Object.values(old).map((r) => listLine(r)).join(''));
    const again = lines(boxRecover());
    for (const tag of OLD) assert.match(again[`old-${tag.replace(/\./g, '-')}`], /^already running/, tag);
    for (const tag of OLD) assert.match(lines(boxRecover(['--force', '--only', `old-${tag.replace(/\./g, '-')}`]))[`old-${tag.replace(/\./g, '-')}`], /^already running/, `${tag} --force`);
    await new Promise((ok) => setTimeout(ok, 300));
    for (const r of Object.values(old)) assert.equal(claudeCalls(r).length, 1);
    // --force --only: one held fleet brought up, its supervisor decides; nothing else touched
    const forced = lines(boxRecover(['--force', '--only', 'old-parked']));
    assert.deepEqual(Object.keys(forced), ['old-parked']);
    assert.match(forced['old-parked'], /^started fresh/);
    assert.ok(!fs.existsSync(upList) || fs.readFileSync(upList, 'utf8').includes(old['v0.25.0']), '--force leaves the list alone');
    const none = boxRecover(['--only', 'no-such']);
    assert.equal(none.status, 1);
    assert.match(none.stderr, /no adopted repo "no-such"/);
  } finally { tmuxSh(['kill-session', '-t', '=home']); fs.rmSync(upList, { force: true }); }
});

test("a repo on a kit from before recover: status and tell go by the pane its kit noted, bare as that kit writes it", { skip: !hasTmux || skipOld() }, async () => {
  const dir = path.join(tmp, 'box-code-noted');
  const r = repo('noted-old', { tag: 'v0.28.0', dir });
  const noted = path.join(r, 'docs/devteam/run/supervisor-pane');
  fs.mkdirSync(path.dirname(noted), { recursive: true });
  const status = () => machine(['machine', 'status', '--in', dir]);
  // a pane at its root running no agent: up only by the note
  const quiet = agent({ screens: ['x'], cwd: r, window: 'sup-noted-old', command: 'exec sleep 3600' });
  try {
    assert.match(status().stdout, /^noted-old sup=down /m, 'nothing noted, nothing agent-shaped');
    fs.writeFileSync(noted, quiet.pane);
    assert.match(status().stdout, /^noted-old sup=up /m, 'the pane its kit noted');
  } finally { quiet.kill(); }
  // two agents at its root, the one first in tmux's list not the noted one: tell types into the noted one
  const decoy = agent({ screens: [box(prompt)], cwd: r, window: 'a-decoy' });
  const sup = agent({ screens: [box(prompt)], cwd: r, window: 'sup-noted-old' });
  try {
    await shown(decoy.pane, 'status');
    await shown(sup.pane, 'status');
    fs.writeFileSync(noted, sup.pane);
    const x = machine(['machine', 'tell', '--in', dir, '--', 'noted-old', 'hello']);
    assert.equal(x.status, 0, x.stdout + x.stderr);
    assert.match(x.stdout, new RegExp(`^noted-old: told \\(pane ${sup.pane}\\)`, 'm'));
    await until(() => sup.keys().includes('\r'), 'the Enter');
    assert.equal(decoy.keys(), '', 'never the other agent');
    assert.match(status().stdout, new RegExp(`^noted-old sup=up .* pane=${sup.pane} `, 'm'));
  } finally { decoy.kill(); sup.kill(); }
});

test('the box\'s list: a repo that couldn\'t start stays listed, two at once start one, and a current kit uses its own recover', { skip: !hasTmux || skipOld() }, async () => {
  const dir = path.join(tmp, 'box-code-2');
  const old = repo('two-old', { tag: 'v0.28.0', dir });
  const v32 = repo('two-v32', { tag: 'v0.32.0', dir });
  const now = repo('two-now', { dir });
  for (const r of [old, v32, now]) conversation(r);
  const run = (args = [], env = {}) => machine(['recover', '--machine', '--in', dir, '--session', 'home', '--was-up', upList, ...args], { DEVTEAM_ROLE: 'operator', ...env });
  try {
    // no tmux session to put them in: nothing starts, and the list keeps them all for the next try
    tmuxSh(['kill-session', '-t', '=home']);
    fs.writeFileSync(upList, [old, v32, now].map((r) => listLine(r, 3600)).join(''));
    const before = fs.readFileSync(upList, 'utf8');
    const none = run();
    assert.equal(none.status, 1);
    for (const n of ['two-old', 'two-v32', 'two-now']) assert.match(lines(none)[n], /^NOT started \(no tmux session home\)/, n);
    assert.equal(fs.readFileSync(upList, 'utf8'), before, 'kept, with when each was first listed');
    // an older box's list (roots alone) and its ages beside it, as the boot folds them in
    homeSession();
    fs.writeFileSync(upList, `${old}\n${v32}\n${listLine(now, 3600)}`);
    const did = run();
    assert.equal(did.status, 0, did.stderr + did.stdout);
    for (const n of ['two-old', 'two-v32', 'two-now']) assert.match(lines(did)[n], new RegExp(`^resumed session ${SID}`), n);
    for (const r of [old, v32, now]) await until(() => claudeCalls(r).length === 1, path.basename(r));
    assert.match(claudeCalls(v32)[0], /This machine restarted/, 'v0.32.0 by its own recover');
    assert.match(claudeCalls(old)[0], /The box restarted/, 'v0.28.0 the old way');
    assert.ok(!fs.existsSync(upList));
    // two at once on an old kit: one supervisor
    tmuxSh(['kill-session', '-t', '=home']);
    homeSession();
    fs.rmSync(path.join(old, '.claude-calls'));
    fs.rmSync(path.join(old, 'docs/devteam/run/supervisor-pane'));
    const once = () => new Promise((ok) => execFile(process.execPath, [KIT, 'recover', '--machine', '--in', dir, '--session', 'home', '--force', '--only', 'two-old'], { cwd: nowhere, env: { ...baseEnv, DEVTEAM_ROLE: 'operator' }, encoding: 'utf8' }, (err, stdout, stderr) => ok({ status: err?.code ?? 0, stdout, stderr })));
    const both = await Promise.all([once(), once()]);
    assert.equal(both.filter((r) => /^two-old: resumed session/m.test(r.stdout)).length, 1, both.map((r) => r.stdout + r.stderr).join('|'));
    assert.equal(both.filter((r) => /^two-old: already running/m.test(r.stdout)).length, 1, both.map((r) => r.stdout).join('|'));
    await until(() => claudeCalls(old).length === 1, 'one ran');
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(claudeCalls(old).length, 1);
    assert.deepEqual(windowsIn('home').filter((w) => w.startsWith('sup-')), ['sup-two-old']);
  } finally { tmuxSh(['kill-session', '-t', '=home']); fs.rmSync(upList, { force: true }); }
});

test('--force skips a sibling whichever sorts first, and never on the list\'s word', { skip: !hasTmux }, () => {
  const dir = path.join(tmp, 'box-code-3');
  const sib = repo('a-sibling', { dir });
  repo('home-repo', { links: { 'a-sibling': link('a-sibling') }, dir });
  repo('mutual-a', { links: { 'mutual-b': link('mutual-b') }, dir });
  repo('mutual-b', { links: { 'mutual-a': link('mutual-a') }, dir });
  const run = (args) => lines(machine(['recover', '--machine', '--in', dir, '--session', 'home', '--was-up', upList, '--dry-run', ...args], { DEVTEAM_ROLE: 'operator' }));
  fs.writeFileSync(upList, listLine(sib));
  try {
    const all = run(['--force']);
    assert.match(all['a-sibling'], /skipped \(a sibling of home-repo\)/);
    assert.match(all['mutual-a'], /^would start fresh/, 'two that link each other are both homes');
    assert.match(all['mutual-b'], /^would start fresh/);
    assert.match(run([])['a-sibling'], /^would start fresh/, 'a repo that ran a supervisor comes back, even if another links to it');
    assert.match(machine(['recover', '--machine', '--was-up'], { DEVTEAM_ROLE: 'operator' }).stderr, /--was-up <file>/, 'the list is named, never implied');
    assert.deepEqual(fs.readdirSync(nowhere), [], 'run from a folder that is no project, nothing lands in it');
  } finally { fs.rmSync(upList, { force: true }); }
});

// The two lines of cloud/Dockerfile's devteam-dev that keep the list: at boot, what was up is added
// with the time; each minute, a supervisor seen up again comes off it.
test('the box\'s boot keeps the list in the form recover reads', () => {
  const df = fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8');
  const add = df.split('\n').find((l) => l.startsWith('if [ -s "$up" ]; then now=$(date +%s)'));
  const fold = df.split('\n').find((l) => l.startsWith('if [ -f "$up.boot.at" ]; then'));
  assert.ok(fold, 'the fold of an older image\'s ages');
  {
    // an older image's .boot.at names every root any boot listed, the stopped ones too
    const d0 = fs.mkdtempSync(path.join(tmp, 'fold-'));
    const up0 = path.join(d0, 'up');
    fs.writeFileSync(`${up0}.boot`, '/r/a\n100 /r/b\n');
    fs.writeFileSync(`${up0}.boot.at`, '50 /r/a\n60 /r/stopped\n70 /r/b\n');
    execFileSync('sh', ['-c', `up=${up0}\n${fold}`]);
    assert.equal(fs.readFileSync(`${up0}.boot`, 'utf8'), '/r/a\n100 /r/b\n50 /r/a\n70 /r/b\n', 'only the roots still listed, bare or timed');
    assert.ok(!fs.existsSync(`${up0}.boot.at`) && !fs.existsSync(`${up0}.boot.was`));
    fs.writeFileSync(`${up0}.boot.at`, '60 /r/stopped\n');
    fs.rmSync(`${up0}.boot`);
    execFileSync('sh', ['-c', `up=${up0}\n${fold}`]);
    assert.ok(!fs.existsSync(`${up0}.boot`), 'no list: nothing to fold into, and nothing comes back');
  }
  const settle = df.split('\n').find((l) => l.includes("awk 'NR == FNR { u[$0]; next }"));
  assert.ok(add && settle, 'the boot\'s lines');
  assert.ok(!df.includes('box-supervisors'), 'nothing calls the old script');
  const d = fs.mkdtempSync(path.join(tmp, 'boot-'));
  const up = path.join(d, 'up');
  fs.writeFileSync(`${up}.boot`, `100 /r/a\n/r/old\n`);
  fs.writeFileSync(up, '/r/a\n/r/b\n');
  execFileSync('sh', ['-c', `up=${up}\n${add}`]);
  assert.match(fs.readFileSync(`${up}.boot`, 'utf8'), /^100 \/r\/a\n\/r\/old\n\d{10} \/r\/a\n\d{10} \/r\/b\n$/);
  fs.writeFileSync(up, '/r/b\n');
  execFileSync('sh', ['-c', `up=${up}\n[ -s "$up" ] && [ -f "$up.boot" ] && {\n${settle}\n  mv "$up.left" "$up.boot"; }`]);
  assert.match(fs.readFileSync(`${up}.boot`, 'utf8'), /^100 \/r\/a\n\/r\/old\n\d{10} \/r\/a\n$/, 'b is back up: off the list');
});

test('the box\'s boot forgets every repo\'s noted pane and its mark', () => {
  const df = fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8');
  const line = df.split('\n').find((l) => l.startsWith('rm -f "$HOME"/code/*/docs/devteam/run/supervisor-pane'));
  assert.ok(line, 'the boot line');
  const home = fs.mkdtempSync(path.join(tmp, 'boot-'));
  const run = path.join(home, 'code', 'a', 'docs', 'devteam', 'run');
  fs.mkdirSync(run, { recursive: true });
  for (const f of ['supervisor-pane', 'supervisor-pane-role', 'supervisor-up.json']) fs.writeFileSync(path.join(run, f), '%3\n');
  execFileSync('sh', ['-c', line], { env: { ...process.env, HOME: home } });
  assert.deepEqual(fs.readdirSync(run).sort(), ['supervisor-up.json'], 'the pane and its mark gone; the up record kept');
});

test('after the first deploy, a supervisor only an older image\'s ages still named stays stopped', { skip: !hasTmux || skipOld() }, () => {
  const dir = path.join(tmp, 'box-code-fold');
  const kept = repo('fold-kept', { tag: 'v0.25.0', dir });
  const stopped = repo('fold-stopped', { tag: 'v0.25.0', dir });
  for (const r of [kept, stopped]) conversation(r);
  const fold = fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8').split('\n').find((l) => l.startsWith('if [ -f "$up.boot.at" ]; then'));
  const up = upList.replace(/\.boot$/, '');
  fs.writeFileSync(upList, `${kept}\n`);
  fs.writeFileSync(`${upList}.at`, `${Math.floor(Date.now() / 1000) - 3600} ${kept}\n${Math.floor(Date.now() / 1000) - 7200} ${stopped}\n`);
  try {
    execFileSync('sh', ['-c', `up=${up}\n${fold}`]);
    const said = lines(machine(['recover', '--machine', '--in', dir, '--session', 'home', '--was-up', upList, '--dry-run'], { DEVTEAM_ROLE: 'operator' }));
    assert.match(said['fold-kept'], new RegExp(`^would resume session ${SID}`));
    assert.match(said['fold-stopped'], /^left stopped \(not running before the restart/, 'the owner stopped it since: it stays stopped');
  } finally { fs.rmSync(upList, { force: true }); fs.rmSync(`${upList}.at`, { force: true }); }
});

test('a pane noted moments ago counts as the supervisor starting only if it started at the repo\'s root', { skip: !hasTmux || skipOld() }, async () => {
  const dir = path.join(tmp, 'box-code-grace');
  const r = repo('grace', { tag: 'v0.28.0', dir });
  conversation(r);
  const paneFile = path.join(r, 'docs/devteam/run/supervisor-pane');
  fs.mkdirSync(path.dirname(paneFile), { recursive: true });
  const dry = () => lines(machine(['recover', '--machine', '--in', dir, '--session', 'home', '--force', '--only', 'grace', '--dry-run'], { DEVTEAM_ROLE: 'operator' })).grace;
  // after a deploy, ids start again at %0: the noted one is now someone else's shell, elsewhere
  const elsewhere = tmuxSh(['new-window', '-dP', '-F', '#{pane_id}', '-t', '=keep:', '-n', 'someone', '-c', nowhere]).stdout.trim();
  const atRoot = tmuxSh(['new-window', '-dP', '-F', '#{pane_id}', '-t', '=keep:', '-n', 'sup-grace', '-c', r]).stdout.trim();
  try {
    fs.writeFileSync(paneFile, elsewhere);
    assert.match(dry(), new RegExp(`^would resume session ${SID}`), 'a pane started elsewhere is not its window');
    fs.writeFileSync(paneFile, atRoot);
    assert.match(dry(), /^already running \(brought back moments ago\)/, 'its window, still a shell until the agent execs');
    const old = new Date(Date.now() - 10 * 60000);
    fs.utimesSync(paneFile, old, old);
    assert.match(dry(), new RegExp(`^would resume session ${SID}`), 'and only for a few minutes');
  } finally { tmuxSh(['kill-pane', '-t', elsewhere]); tmuxSh(['kill-pane', '-t', atRoot]); }
});

// The hub line names the release serving the hub, from its list: the image's own, a project kit's,
// one too old to say, something that isn't a hub, or nothing at all. Run without blocking this
// process, whose event loop serves the stand-in hub.
test('status names the hub\'s kit, or says it is no hub, or down', async () => {
  const port = Number(process.env.DEVTEAM_HUB_PORT);
  const env = { ...baseEnv };
  for (const k of ['DEVTEAM_IMAGE_HUB', 'DEVTEAM_KIT_RELEASE', 'DEVTEAM_BOX_TOOLS']) delete env[k];
  const empty = fs.mkdtempSync(path.join(tmp, 'no-repos-'));
  const hubLineOf = () => new Promise((resolve) => execFile(process.execPath, [KIT, 'machine', 'status', '--in', empty], { cwd: nowhere, encoding: 'utf8', env }, (err, stdout) => resolve(stdout.split('\n').find((l) => l.startsWith('machine: hub ')))));
  let body = '';
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(req.url === '/instances.json' ? body : 'not found'); });
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  let open = true;
  try {
    const cases = [
      [{ hub: 1, kit: 'v1.2.3', image: true, instances: [] }, 'up, kit v1.2.3 (image)'],
      [{ hub: 1, kit: 'v1.2.3', instances: [] }, 'up, kit v1.2.3'],
      [{ hub: 1, instances: [] }, 'up, kit ?'],
      [{ hub: 1, kit: null, instances: [] }, 'up, kit ?'],
      [{ hub: 1, kit: '\u001b[31mx', instances: [] }, 'up, kit ?'],
      [{ hub: 1, kit: 'v'.repeat(10240), instances: [] }, 'up, kit ?'],
      ['ok', 'up, not a hub'],
      [{ hub: 1, kit: 'v1.2.3', instances: [], pad: 'x'.repeat(70 * 1024) }, 'up, not a hub'],
    ];
    for (const [b, want] of cases) {
      body = typeof b === 'string' ? b : JSON.stringify(b);
      assert.equal(await hubLineOf(), `machine: hub ${port} ${want}`, body.slice(0, 80));
    }
    // something on the port that answers and never finishes, a byte at a time: status still ends,
    // within its 3 s, and says it isn't a hub
    const drip = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); const i = setInterval(() => res.write(' '), 1000); res.on('close', () => clearInterval(i)); });
    await new Promise((r) => srv.close(r));
    await new Promise((r) => drip.listen(port, '127.0.0.1', r));
    const started = Date.now();
    try { assert.equal(await hubLineOf(), `machine: hub ${port} up, not a hub`); } finally { drip.closeAllConnections?.(); await new Promise((r) => drip.close(r)); }
    assert.ok(Date.now() - started < 8000, `status waited ${Date.now() - started} ms on a server that drips`);
    await new Promise((r) => srv.listen(port, '127.0.0.1', r));
    body = JSON.stringify({ hub: 1, kit: 'v1.2.3', instances: [] });
    machine(['machine', 'alert', '--', 'look']);
    assert.equal(await hubLineOf(), `machine: hub ${port} up, kit v1.2.3; alert: look`, 'the alert suffix as it was');
    machine(['machine', 'alert', '--', '--clear']);
    await new Promise((r) => srv.close(r));
    open = false;
    assert.equal(await hubLineOf(), `machine: hub ${port} DOWN`);
  } finally {
    machine(['machine', 'alert', '--', '--clear']);
    if (open) srv.close();
  }
});

// ===== box-pins: the box image's tool pins in cloud/Dockerfile =====
// verify, check and bump run a copy of the kit in a repo that is the kit's own (so they run as KIT_VIEWS
// do, on a fork's CI too), against a copy of the Dockerfile whose pins are set to the values below: a
// real bump or hold in cloud/Dockerfile never changes what these tests expect.
const FIXED = { CLAUDE_CODE: '2.1.307', CLAUDE_SWAP: '1.0.0', GH: '2.104.0', TTYD: '1.7.7', MISE: 'v2026.10.17', UV: '0.13.7' };
const FIXED_RELEASE = 'v0.52.0';
const fixedSum = (arg) => crypto.createHash('sha256').update(arg).digest('hex');
const pinsRepo = path.join(tmp, 'pins-kit');
fs.mkdirSync(pinsRepo);
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: pinsRepo });
execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:sanctuarycomputer/devteam.git'], { cwd: pinsRepo });
fs.cpSync(kit, path.join(pinsRepo, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
let pinsCopies = 0;
function pinsCopy(edit = (t) => t) {
  let t = fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8')
    .replace(/^ARG ([A-Z_]+?)_VERSION=.*$/gm, (l, p) => (p in FIXED ? `ARG ${p}_VERSION=${FIXED[p]}` : l))
    .replace(/^ARG ([A-Z_]+_SHA256_(?:X86_64|AARCH64))=.*$/gm, (l, a) => `ARG ${a}=${fixedSum(a)}`)
    .replace(/^ARG DEVTEAM_RELEASE=.*$/m, `ARG DEVTEAM_RELEASE=${FIXED_RELEASE}`)
    .split('\n').filter((l) => !/^\s*#\s*hold\b/i.test(l)).join('\n');
  t = edit(t);
  const f = path.join(tmp, 'pins', `Dockerfile.${++pinsCopies}`);
  write(f, t);
  return f;
}
const PINS_CLEARED = ['DEVTEAM_IMAGE_HUB', 'DEVTEAM_KIT_RELEASE', 'DEVTEAM_BOX_TOOLS', 'DEVTEAM_PINS_NPM', 'DEVTEAM_PINS_PYPI', 'DEVTEAM_PINS_GITHUB', 'DEVTEAM_BOX_BIN', 'GH_TOKEN', 'GITHUB_TOKEN', 'UV_TOOL_DIR'];
const pinsEnv = (extra = {}) => { const e = { ...baseEnv }; for (const k of PINS_CLEARED) delete e[k]; return { ...e, ...extra }; };
const pinsKit = path.join(pinsRepo, 'docs', 'devteam', 'scripts', 'devteam.mjs');
const pins = (args, env = {}) => spawnSync(process.execPath, [pinsKit, 'box-pins', ...args], { cwd: pinsRepo, encoding: 'utf8', env: pinsEnv(env) });
const pinsAsync = (args, env = {}) => new Promise((resolve) => execFile(process.execPath, [pinsKit, 'box-pins', ...args], { cwd: pinsRepo, encoding: 'utf8', env: pinsEnv(env) }, (err, stdout, stderr) => resolve({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })));

test('box-pins verify: ok on the kit\'s own Dockerfile; exit 2 with none', () => {
  const ok = pins(['verify', '--dockerfile', path.join(REPO, 'cloud/Dockerfile')]);
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.match(ok.stdout, /^box-pins verify: ok, 6 tools, release v\d+\.\d+\.\d+$/m);
  assert.equal(pins(['verify', '--dockerfile', pinsCopy()]).status, 0, 'the fixed copy is a good file');
  const none = pins(['verify']);
  assert.equal(none.status, 2, none.stderr + none.stdout);
  assert.match(none.stdout + none.stderr, /no cloud\/Dockerfile at .*cloud\/Dockerfile/);
});

test('box-pins verify names each problem and exits 1', () => {
  const cases = [
    [(t) => t.replace(/^(ARG TTYD_SHA256_X86_64=)\w+$/m, '$1ABC'), /TTYD_SHA256_X86_64 is not 64 lowercase hex/],
    [(t) => t.replace(/^ARG GH_SHA256_AARCH64=\w+\n/m, ''), /gh has no GH_SHA256_AARCH64/],
    [(t) => t.replace(/^ARG DEVTEAM_RELEASE=.*$/m, 'ARG DEVTEAM_RELEASE=0.52'), /DEVTEAM_RELEASE 0\.52 is not vX\.Y\.Z/],
  ];
  for (const [edit, re] of cases) { const r = pins(['verify', '--dockerfile', pinsCopy(edit)]); assert.equal(r.status, 1, String(re)); assert.match(r.stdout, re); }
  const url = pins(['verify', '--dockerfile', pinsCopy((t) => t.replace('download/v$GH_VERSION/gh_${GH_VERSION}_linux', `download/v${FIXED.GH}/gh_${FIXED.GH}_linux`))]);
  assert.equal(url.status, 1); assert.match(url.stdout, /gh's version 2\.104\.0 is written outside its ARG \(line \d+: /);
  const rel = pins(['verify', '--release', 'v1.2.3', '--dockerfile', pinsCopy()]);
  assert.equal(rel.status, 1); assert.match(rel.stdout, /DEVTEAM_RELEASE is v0\.52\.0, not v1\.2\.3/);
  assert.equal(pins(['verify', '--release', FIXED_RELEASE, '--dockerfile', pinsCopy()]).status, 0);
});

test('verify does not count another tool\'s own ARG as a stray literal', () => {
  const f = pinsCopy((t) => t.replace(/^ARG TTYD_VERSION=.*$/m, `ARG TTYD_VERSION=${FIXED.CLAUDE_SWAP}`));
  const r = pins(['verify', '--dockerfile', f]);
  assert.equal(r.status, 0, r.stdout);
  const g = pinsCopy((t) => t.replace(/^(# ttyd, the web terminal)$/m, `$1 ${FIXED.CLAUDE_SWAP}`));
  assert.match(pins(['verify', '--dockerfile', g]).stdout, /claude-swap's version 1\.0\.0 is written outside its ARG/);
});

test('verify takes a hold above the _VERSION ARG, and refuses one with no reason, misplaced or misspelled', () => {
  assert.equal(pins(['verify', '--dockerfile', pinsCopy((t) => t.replace(/^ARG MISE_VERSION=/m, '# hold: waiting on a fix\n$&'))]).status, 0);
  const r = pins(['verify', '--dockerfile', pinsCopy((t) => t.replace(/^ARG MISE_VERSION=/m, '# hold:\n$&'))]);
  assert.equal(r.status, 1); assert.match(r.stdout, /mise's hold has no reason/);
  const far = pins(['verify', '--dockerfile', pinsCopy((t) => t.replace(/^# ttyd, the web terminal$/m, '# hold: bad build\n$&'))]);
  assert.equal(far.status, 1); assert.match(far.stdout, /the hold on line \d+ is not directly above a _VERSION ARG/);
  const odd = pins(['verify', '--dockerfile', pinsCopy((t) => t.replace(/^ARG MISE_VERSION=/m, '# Hold: x\n$&'))]);
  assert.equal(odd.status, 1); assert.match(odd.stdout, /line \d+ looks like a hold but is not "# hold: <reason>"/);
});

test('verify names what it found, where (task-1 review)', () => {
  const lineOf = (f, re) => fs.readFileSync(f, 'utf8').split('\n').findIndex((l) => re.test(l)) + 1;
  const run = (edit) => { const f = pinsCopy(edit); return { f, r: pins(['verify', '--dockerfile', f]) }; };
  // the stray's own text is shown, even deep in a long line
  const u = run((t) => t.replace('download/v$GH_VERSION/gh_${GH_VERSION}_linux', `download/v${FIXED.GH}/gh_${FIXED.GH}_linux`));
  assert.match(u.r.stdout, new RegExp(`gh's version 2\\.104\\.0 is written outside its ARG \\(line ${lineOf(u.f, /download\/v2\.104\.0/)}: .*v2\\.104\\.0/gh_2\\.104\\.0`));
  const sum = fixedSum('UV_SHA256_X86_64');
  const s1 = run((t) => t.replace('x86_64) sum=$UV_SHA256_X86_64', `x86_64) sum=${sum}`));
  assert.match(s1.r.stdout, new RegExp(`uv's UV_SHA256_X86_64 sum is written outside its ARG \\(line ${lineOf(s1.f, /x86_64\) sum=[0-9a-f]{64}/)}: .*${sum}`));
  // mise's version is searched without its v
  assert.match(run((t) => t.replace('-linux-$arch"', '-linux-$arch" # 2026.10.17')).r.stdout, /mise's version v2026\.10\.17 is written outside its ARG/);
  // a stamp or a hold naming a version is no stray
  assert.equal(run((t) => t.replace(/^ARG UV_VERSION=/m, '# hold: 0.13.8 breaks the build; stay on 0.13.7\n$&')).r.status, 0);
  // exactly "# hold: <reason>", unindented, right above the ARG
  const far = run((t) => t.replace(/^# ttyd, the web terminal$/m, '# hold: bad build\n$&'));
  assert.match(far.r.stdout, new RegExp(`the hold on line ${lineOf(far.f, /^# hold: bad build$/)} is not directly above a _VERSION ARG`));
  for (const bad of ['# hold:x', '  # hold: x', '#hold: x']) assert.match(run((t) => t.replace(/^ARG MISE_VERSION=/m, `${bad}\n$&`)).r.stdout, /looks like a hold but is not "# hold: <reason>"/, bad);
  // the ARGs: given twice, or empty
  assert.match(run((t) => t.replace(/^ARG UV_VERSION=.*$/m, '$&\n$&')).r.stdout, /uv's UV_VERSION is given 2 times/);
  assert.match(run((t) => t.replace(/^ARG UV_VERSION=.*$/m, 'ARG UV_VERSION=')).r.stdout, /uv's UV_VERSION is empty/);
  assert.match(run((t) => t.replace(/^ARG DEVTEAM_RELEASE=.*$/m, '')).r.stdout, /no DEVTEAM_RELEASE/);
  // DEVTEAM_BOX_TOOLS names exactly the six pins
  assert.match(run((t) => t.replace(' uv=$UV_VERSION', '')).r.stdout, /DEVTEAM_BOX_TOOLS does not name uv=\$UV_VERSION/);
  assert.match(run((t) => t.replace(' uv=$UV_VERSION', ' uv=$UV_VERSION node=$NODE_VERSION')).r.stdout, /DEVTEAM_BOX_TOOLS names node=\$NODE_VERSION, which is no tool's/);
  assert.match(run((t) => t.replace(/^\s*DEVTEAM_BOX_TOOLS=.*$/m, '    DEVTEAM_X=1')).r.stdout, /no DEVTEAM_BOX_TOOLS/);
  // a pin that isn't a plain version could never be compared: a problem, so check and bump refuse it
  assert.match(run((t) => t.replace(/^ARG UV_VERSION=.*$/m, 'ARG UV_VERSION=0.13.7-rc1')).r.stdout, /uv's UV_VERSION 0\.13\.7-rc1 is not a plain version/);
  // the stamp's line is no stray for a tool at the same number
  assert.equal(run((t) => t.replace(/^ARG UV_VERSION=.*$/m, 'ARG UV_VERSION=0.52.0')).r.status, 0);
  // a --release that isn't vX.Y.Z is a usage error
  const bad = pins(['verify', '--release', 'v1.2', '--dockerfile', pinsCopy()]);
  assert.equal(bad.status, 1); assert.match(bad.stderr, /--release "v1\.2" is not vX\.Y\.Z/); assert.match(bad.stderr, /usage: box-pins verify/);
});

// npm, PyPI and GitHub in one in-process server; downloads redirect to the bytes, as GitHub's do.
// Every tool's default latest is one release past FIXED; each asset's bytes are its own.
const LATEST = { 'claude-code': '2.1.308', 'claude-swap': '1.0.1', gh: 'v2.105.0', ttyd: '1.7.8', mise: 'v2026.11.8', uv: '0.13.8' };
const REPOS = { gh: 'cli/cli', ttyd: 'tsl0922/ttyd', mise: 'jdx/mise', uv: 'astral-sh/uv' };
const assetNames = (tool, tag) => ({
  gh: [`gh_${tag.replace(/^v/, '')}_linux_amd64.tar.gz`, `gh_${tag.replace(/^v/, '')}_linux_arm64.tar.gz`],
  ttyd: ['ttyd.x86_64', 'ttyd.aarch64'],
  mise: [`mise-${tag}-linux-x64`, `mise-${tag}-linux-arm64`],
  uv: ['uv-x86_64-unknown-linux-gnu.tar.gz', 'uv-aarch64-unknown-linux-gnu.tar.gz'],
}[tool]);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
async function upstream(t) {
  const state = { npm: { '@anthropic-ai/claude-code': LATEST['claude-code'] }, pypi: { 'claude-swap': LATEST['claude-swap'] }, releases: {}, assets: {}, hits: [] };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    state.hits.push({ path: u.pathname, headers: req.headers });
    const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
    let m;
    if (u.pathname.startsWith('/npm/') && !req.url.includes('%2f')) return json({}, 404);
    if (u.pathname.startsWith('/gh/') && (u.searchParams.get('per_page') !== '30' || req.headers.accept !== 'application/vnd.github+json')) return json({}, 400);
    if (state.hang?.(u.pathname)) return;
    if (state.stall?.(u.pathname)) { res.writeHead(200, { 'content-length': '1000' }); return res.write('part of a body'); }
    if ((m = /^\/npm\/(.+)\/latest$/.exec(u.pathname))) { const v = state.npm[decodeURIComponent(m[1])]; return v === undefined ? json({}, 404) : v.status ? json({}, v.status) : json({ version: v }); }
    if ((m = /^\/pypi\/pypi\/([^/]+)\/json$/.exec(u.pathname))) { const v = state.pypi[m[1]]; return v === undefined ? json({}, 404) : v.status ? json({}, v.status) : json({ info: { version: v } }); }
    if ((m = /^\/gh\/repos\/([^/]+\/[^/]+)\/releases$/.exec(u.pathname))) { const v = state.releases[m[1]]; return v === undefined ? json([], 404) : v.status ? json({}, v.status) : v.raw !== undefined ? json(v.raw) : json(v); }
    if ((m = /^\/dl\/(.+)$/.exec(u.pathname))) { res.writeHead(302, { location: `/assets/${m[1]}` }); return res.end(); }
    if ((m = /^\/assets\/(.+)$/.exec(u.pathname))) { const a = state.assets[m[1]]; if (!a || a.status) { res.writeHead(a?.status ?? 404); return res.end(); } res.writeHead(200); return res.end(a.body); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  srv.unref();
  t.after(() => { srv.closeAllConnections?.(); srv.close(); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  // a release of tool at tag, with both arch assets served, and a digest of their real bytes
  const release = (tool, tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, ...extra, assets: assetNames(tool, tag).map((name) => {
    const key = `${REPOS[tool]}/${name}`;
    const body = `${key}/${tag}`;
    state.assets[key] = { body };
    return { name, browser_download_url: `${url}/dl/${key}`, digest: `sha256:${sha256(body)}` };
  }) });
  for (const tool of Object.keys(REPOS)) state.releases[REPOS[tool]] = [release(tool, LATEST[tool])];
  return { url, state, release };
}
const upEnv = (u) => ({ DEVTEAM_PINS_NPM: `${u.url}/npm`, DEVTEAM_PINS_PYPI: `${u.url}/pypi`, DEVTEAM_PINS_GITHUB: `${u.url}/gh` });
const closedPort = async () => { const s = net.createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise((r) => s.close(r)); return p; };

test('box-pins check: one line per tool; stale exits 1; held, current; --json the same', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy();
  const r = await pinsAsync(['check', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.deepEqual(r.stdout.trim().split('\n'), [
    'claude-code: stale 2.1.307 -> 2.1.308', 'claude-swap: stale 1.0.0 -> 1.0.1', 'gh: stale 2.104.0 -> 2.105.0',
    'ttyd: stale 1.7.7 -> 1.7.8', 'mise: stale v2026.10.17 -> v2026.11.8', 'uv: stale 0.13.7 -> 0.13.8',
  ]);
  // everything current but gh, which is held: nothing asked of cli/cli, exit 0
  u.state.npm['@anthropic-ai/claude-code'] = FIXED.CLAUDE_CODE;
  u.state.pypi['claude-swap'] = FIXED.CLAUDE_SWAP;
  for (const [tool, p] of [['ttyd', 'TTYD'], ['mise', 'MISE'], ['uv', 'UV']]) u.state.releases[REPOS[tool]] = [u.release(tool, FIXED[p])];
  u.state.hits.length = 0;
  const held = pinsCopy((x) => x.replace(/^ARG GH_VERSION=/m, '# hold: 2.105 breaks auth\n$&'));
  const c = await pinsAsync(['check', '--dockerfile', held], upEnv(u));
  assert.equal(c.status, 0, c.stderr + c.stdout);
  assert.deepEqual(c.stdout.trim().split('\n'), ['claude-code: current 2.1.307', 'claude-swap: current 1.0.0', 'gh: held 2.105 breaks auth', 'ttyd: current 1.7.7', 'mise: current v2026.10.17', 'uv: current 0.13.7']);
  assert.ok(!u.state.hits.some((h) => h.path.includes('cli/cli')), 'a held tool is not asked about');
  const j = await pinsAsync(['check', '--json', '--dockerfile', held], upEnv(u));
  assert.equal(j.status, 0);
  const o = JSON.parse(j.stdout);
  assert.equal(o.box_pins, 1);
  assert.deepEqual(o.tools.map((x) => [x.name, x.status]), [['claude-code', 'current'], ['claude-swap', 'current'], ['gh', 'held'], ['ttyd', 'current'], ['mise', 'current'], ['uv', 'current']]);
  assert.equal(o.tools[2].reason, '2.105 breaks auth');
  const sj = JSON.parse((await pinsAsync(['check', '--json', '--dockerfile', f], upEnv(u))).stdout);
  assert.deepEqual(sj.tools.find((x) => x.name === 'gh'), { name: 'gh', pinned: '2.104.0', status: 'stale', latest: '2.105.0' });
});

test('check ignores a GitHub prerelease and a draft, and takes the highest release, not the newest entry', async (t) => {
  const u = await upstream(t);
  u.state.releases['tsl0922/ttyd'] = [u.release('ttyd', '1.9.0', { prerelease: true }), u.release('ttyd', '2.0.0', { draft: true }), u.release('ttyd', '1.6.9'), u.release('ttyd', '1.7.8')];
  const r = await pinsAsync(['check', '--dockerfile', pinsCopy()], upEnv(u));
  assert.match(r.stdout, /^ttyd: stale 1\.7\.7 -> 1\.7\.8$/m);
});

test('check reports an unreachable upstream as unknown, and junk as unknown, never raw', async (t) => {
  const u = await upstream(t);
  for (const [tool, p] of [['gh', 'GH'], ['ttyd', 'TTYD'], ['mise', 'MISE'], ['uv', 'UV']]) u.state.releases[REPOS[tool]] = [u.release(tool, tool === 'gh' ? `v${FIXED[p]}` : FIXED[p])];
  u.state.pypi['claude-swap'] = '1.2.3\u001b[2J';
  const r = await pinsAsync(['check', '--dockerfile', pinsCopy()], { ...upEnv(u), DEVTEAM_PINS_NPM: `http://127.0.0.1:${await closedPort()}` });
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.match(r.stdout, /^claude-code: unknown unreachable/m);
  assert.match(r.stdout, /^claude-swap: unknown not a release: \?$/m);
  assert.match(r.stdout, /^gh: current 2\.104\.0$/m);
  assert.ok(!r.stdout.includes('\u001b'));
  u.state.releases['jdx/mise'] = { status: 500 };
  assert.match((await pinsAsync(['check', '--dockerfile', pinsCopy()], upEnv(u))).stdout, /^mise: unknown HTTP 500$/m);
});

test('check: stale wins over unknown; no release, bad JSON and a timeout are unknown (task-2 review)', async (t) => {
  const u = await upstream(t);
  u.state.releases['tsl0922/ttyd'] = [u.release('ttyd', '1.9.0', { prerelease: true })];
  u.state.releases['jdx/mise'] = { raw: 'not json' };
  u.state.hang = (p) => p.includes('astral-sh/uv');
  const r = await pinsAsync(['check', '--dockerfile', pinsCopy()], { ...upEnv(u), DEVTEAM_PINS_TIMEOUT_MS: '500' });
  assert.equal(r.status, 1, 'a stale pin decides the exit, whatever else is unknown');
  assert.match(r.stdout, /^gh: stale /m);
  assert.match(r.stdout, /^ttyd: unknown no release$/m);
  assert.match(r.stdout, /^mise: unknown bad JSON$/m);
  assert.match(r.stdout, /^uv: unknown unreachable \(timed out\)$/m);
  const j = await pinsAsync(['check', '--json', '--dockerfile', pinsCopy()], { ...upEnv(u), DEVTEAM_PINS_TIMEOUT_MS: '500' });
  assert.equal(j.status, 1);
});

test('check sends GH_TOKEN to the GitHub API, and nowhere else', async (t) => {
  const u = await upstream(t);
  await pinsAsync(['check', '--dockerfile', pinsCopy()], { ...upEnv(u), GH_TOKEN: 'fake-token' });
  const gh = u.state.hits.filter((h) => h.path.startsWith('/gh/'));
  assert.equal(gh.length, 4);
  for (const h of gh) assert.equal(h.headers.authorization, 'Bearer fake-token');
  for (const h of u.state.hits.filter((x) => !x.path.startsWith('/gh/'))) assert.equal(h.headers.authorization, undefined, h.path);
  u.state.hits.length = 0;
  await pinsAsync(['check', '--dockerfile', pinsCopy()], upEnv(u));
  for (const h of u.state.hits) assert.equal(h.headers.authorization, undefined, 'none without GH_TOKEN');
});

test('check on a broken file exits 2 with its problems, in --json too', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy((x) => x.replace(/^ARG TTYD_SHA256_X86_64=\w+\n/m, ''));
  const r = await pinsAsync(['check', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^box-pins check: ttyd has no TTYD_SHA256_X86_64$/m);
  const j = await pinsAsync(['check', '--json', '--dockerfile', f], upEnv(u));
  assert.equal(j.status, 2);
  assert.deepEqual(JSON.parse(j.stdout), { box_pins: 1, problems: ['ttyd has no TTYD_SHA256_X86_64'] });
  assert.equal(u.state.hits.length, 0, 'nothing asked of upstream');
});

const argOf = (text, name) => new RegExp(`^ARG ${name}=(.*)$`, 'm').exec(text)?.[1];
const fileSha = (f) => sha256(fs.readFileSync(f));
const assetBody = (tool, tag, i) => `${REPOS[tool]}/${assetNames(tool, tag)[i]}/${tag}`;

test('box-pins bump --release v9.9.9 sets each unheld tool to latest with the assets\' real sums', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy((x) => x.replace(/^ARG UV_VERSION=/m, '# hold: 0.13.8 breaks claude-swap\n$&'));
  const before = fs.readFileSync(f, 'utf8');
  const r = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const after = fs.readFileSync(f, 'utf8');
  assert.deepEqual(['CLAUDE_CODE', 'CLAUDE_SWAP', 'GH', 'TTYD', 'MISE', 'UV'].map((p) => argOf(after, `${p}_VERSION`)), ['2.1.308', '1.0.1', '2.105.0', '1.7.8', 'v2026.11.8', FIXED.UV]);
  for (const [tool, p] of [['gh', 'GH'], ['ttyd', 'TTYD'], ['mise', 'MISE']]) {
    assert.equal(argOf(after, `${p}_SHA256_X86_64`), sha256(assetBody(tool, LATEST[tool], 0)), `${tool} x86_64`);
    assert.equal(argOf(after, `${p}_SHA256_AARCH64`), sha256(assetBody(tool, LATEST[tool], 1)), `${tool} aarch64`);
  }
  for (const a of ['UV_VERSION', 'UV_SHA256_X86_64', 'UV_SHA256_AARCH64']) assert.equal(argOf(after, a), argOf(before, a), `held uv keeps ${a}`);
  assert.match(after, /^# hold: 0\.13\.8 breaks claude-swap\nARG UV_VERSION=/m);
  assert.ok(!u.state.hits.some((h) => h.path.includes('astral-sh/uv')), 'nothing asked about a held tool');
  assert.equal(argOf(after, 'DEVTEAM_RELEASE'), 'v9.9.9');
  assert.match(r.stdout, /^TTYD_VERSION 1\.7\.7 -> 1\.7\.8$/m);
  assert.match(r.stdout, /^held uv: 0\.13\.8 breaks claude-swap$/m);
  assert.match(r.stdout, new RegExp(`^wrote ${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  const notArg = (x) => x.split('\n').filter((l) => !l.startsWith('ARG '));
  assert.deepEqual(notArg(after), notArg(before), 'only ARG lines were rewritten');
  assert.equal(pins(['verify', '--release', 'v9.9.9', '--dockerfile', f]).status, 0);
});

test('bump --dry-run prints the change and leaves the file byte-identical', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy();
  const sum = fileSha(f);
  const r = await pinsAsync(['bump', '--release', 'v9.9.9', '--dry-run', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /^TTYD_VERSION 1\.7\.7 -> 1\.7\.8$/m);
  assert.match(r.stdout, new RegExp(`^TTYD_SHA256_X86_64 ${fixedSum('TTYD_SHA256_X86_64')} -> ${sha256(assetBody('ttyd', '1.7.8', 0))}$`, 'm'));
  assert.match(r.stdout, /^DEVTEAM_RELEASE v0\.52\.0 -> v9\.9\.9$/m);
  assert.match(r.stdout, /^--dry-run: nothing written$/m);
  assert.equal(fileSha(f), sum);
});

test('bump writes nothing when an upstream fails, or a digest disagrees', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy();
  const sum = fileSha(f);
  u.state.assets[`cli/cli/${assetNames('gh', LATEST.gh)[1]}`] = { status: 500 };
  const r = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /box-pins bump: gh: .*500.*; nothing written/);
  assert.equal(fileSha(f), sum);
  u.state.assets[`cli/cli/${assetNames('gh', LATEST.gh)[1]}`] = { body: assetBody('gh', LATEST.gh, 1) };
  u.state.releases['jdx/mise'][0].assets[0].digest = `sha256:${'0'.repeat(64)}`;
  const d = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(d.status, 1, d.stdout);
  assert.match(d.stderr, /box-pins bump: mise: .*digest.*; nothing written/);
  assert.equal(fileSha(f), sum);
  u.state.releases['jdx/mise'][0].assets[0].digest = `sha256:${sha256(assetBody('mise', LATEST.mise, 0))}`;
  u.state.npm['@anthropic-ai/claude-code'] = { status: 503 };
  const n = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(n.status, 1);
  assert.match(n.stderr, /box-pins bump: claude-code: HTTP 503; nothing written/);
  assert.equal(fileSha(f), sum);
});

test('bump sends no token with a download', async (t) => {
  const u = await upstream(t);
  const r = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', pinsCopy()], { ...upEnv(u), GH_TOKEN: 'fake-token' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(u.state.hits.some((h) => h.path.startsWith('/dl/')) && u.state.hits.some((h) => h.path.startsWith('/assets/')), 'downloads went through the redirect');
  for (const h of u.state.hits) {
    if (h.path.startsWith('/gh/')) assert.equal(h.headers.authorization, 'Bearer fake-token');
    else assert.equal(h.headers.authorization, undefined, h.path);
  }
});

test('bump keeps the file\'s mode, and writes nothing when nothing changes', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy();
  fs.chmodSync(f, 0o664); // group-writable: a umask of 022 alone would lose it
  assert.equal((await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u))).status, 0);
  assert.equal(fs.statSync(f).mode & 0o777, 0o664);
  const { mtimeMs } = fs.statSync(f);
  const sum = fileSha(f);
  const again = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /^unchanged$/m);
  assert.equal(fileSha(f), sum);
  assert.equal(fs.statSync(f).mtimeMs, mtimeMs);
  assert.deepEqual(fs.readdirSync(path.dirname(f)).filter((x) => x.endsWith('.tmp')), [], 'no temp file left');
});

test('bump and check refuse a malformed hold', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy((x) => x.replace(/^ARG MISE_VERSION=/m, '# Hold: x\n$&'));
  const sum = fileSha(f);
  const b = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(b.status, 1);
  assert.match(b.stdout, /box-pins bump: line \d+ looks like a hold but is not "# hold: <reason>"/);
  assert.equal(fileSha(f), sum);
  assert.equal((await pinsAsync(['check', '--dockerfile', f], upEnv(u))).status, 2);
  assert.equal(u.state.hits.length, 0, 'nothing asked of upstream');
});

test('bump refuses a --release older than the stamp, and needs one', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy();
  const sum = fileSha(f);
  const r = await pinsAsync(['bump', '--release', 'v0.1.0', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--release v0\.1\.0 is older than DEVTEAM_RELEASE v0\.52\.0/);
  const none = await pinsAsync(['bump', '--dockerfile', f], upEnv(u));
  assert.equal(none.status, 1);
  assert.match(none.stderr, /usage: box-pins/);
  assert.equal(fileSha(f), sum);
  assert.equal(u.state.hits.length, 0);
});

test('bump writes nothing that would not verify, says a failed download in its own words, and bumps a symlink\'s target (task-3 review)', async (t) => {
  const u = await upstream(t);
  // a comment already naming ttyd's next version becomes a stray once ttyd moves to it
  const f = pinsCopy((x) => x.replace(/^# ttyd, the web terminal$/m, '$& (1.7.8 fixes resize)'));
  const sum = fileSha(f);
  const r = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /box-pins bump: the result would not verify \(ttyd's version 1\.7\.8 is written outside its ARG .*\); nothing written/);
  assert.equal(fileSha(f), sum);
  // a refused download: our words and the error code, not Node's message
  for (const n of assetNames('uv', LATEST.uv)) u.state.releases['astral-sh/uv'][0].assets.find((a) => a.name === n).browser_download_url = `http://127.0.0.1:${await closedPort()}/x`;
  const d = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', pinsCopy()], upEnv(u));
  assert.equal(d.status, 1);
  assert.match(d.stderr, /box-pins bump: uv: download of uv-x86_64-unknown-linux-gnu\.tar\.gz failed \(ECONNREFUSED\); nothing written/);
  // a download whose body stalls after its headers: timed out
  u.state.releases['astral-sh/uv'] = [u.release('uv', LATEST.uv)];
  u.state.stall = (p) => p.startsWith('/assets/astral-sh/');
  const h = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', pinsCopy()], { ...upEnv(u), DEVTEAM_PINS_TIMEOUT_MS: '500' });
  assert.equal(h.status, 1);
  assert.match(h.stderr, /box-pins bump: uv: download of .* failed \(timed out\); nothing written/);
  u.state.stall = null;
  // --dockerfile a symlink: its target is bumped and the link stays a link
  const target = pinsCopy();
  const link = path.join(path.dirname(target), 'Dockerfile.link');
  fs.symlinkSync(target, link);
  const l = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', link], upEnv(u));
  assert.equal(l.status, 0, l.stderr);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(argOf(fs.readFileSync(target, 'utf8'), 'DEVTEAM_RELEASE'), 'v9.9.9');
});

test('bump downloads nothing for a tool already current', async (t) => {
  const u = await upstream(t);
  u.state.releases['tsl0922/ttyd'] = [u.release('ttyd', FIXED.TTYD)];
  for (const n of assetNames('ttyd', FIXED.TTYD)) u.state.assets[`tsl0922/ttyd/${n}`] = { status: 500 };
  const f = pinsCopy();
  const before = fs.readFileSync(f, 'utf8');
  const r = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(!u.state.hits.some((h) => /^\/(dl|assets)\/tsl0922\//.test(h.path)), 'no ttyd download');
  const after = fs.readFileSync(f, 'utf8');
  for (const a of ['TTYD_VERSION', 'TTYD_SHA256_X86_64', 'TTYD_SHA256_AARCH64']) assert.equal(argOf(after, a), argOf(before, a));
});

// installed, as the image runs it: the image's kit (a folder that is no repo), from a cwd that is no
// repo, each tool by its path in the image (here DEVTEAM_BOX_BIN), and a PATH whose first uv is
// mise's shim, which a lookup through PATH would wrongly ask.
const imageKit = path.join(tmp, 'image-kit');
fs.cpSync(kit, imageKit, { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
const TOOLS_ENV = 'claude-code=2.1.307 claude-swap=1.0.0 gh=2.104.0 ttyd=1.7.7 mise=v2026.10.17 uv=0.13.7';
function fakeBins(name, scripts) {
  const d = path.join(tmp, name);
  for (const [f, body] of Object.entries(scripts)) { write(path.join(d, f), `#!/bin/sh\n${body}\n`); fs.chmodSync(path.join(d, f), 0o755); }
  return d;
}
const say = (s) => `printf '%s\\n' ${s.split('\n').map((l) => `'${l}'`).join(' ')}`;
const boxBin = fakeBins('box-bin', {
  claude: say('2.1.307 (Claude Code)'),
  gh: say('gh version 2.104.0 (2026-10-01)\nhttps://github.com/cli/cli/releases/tag/v2.104.0'),
  ttyd: say('ttyd version 1.7.7-40e79c7'),
  mise: say('2026.10.17 linux-x64 (2026-10-21)'),
  uv: `case "$1" in
  --version) ${say('uv 0.13.7 (x86_64-unknown-linux-gnu)')} ;;
  tool) if [ "$UV_TOOL_DIR" = /opt/uv/tools ]; then ${say('claude-swap v1.0.0\n- claude-swap\n- cswap')}; else echo 'No tools installed'; fi ;;
  *) exit 2 ;;
esac`,
});
const shimBin = fakeBins('shim-bin', { claude: say('9.9.9 (Claude Code)'), gh: say('gh version 9.9.9'), ttyd: say('ttyd version 9.9.9'), mise: say('9.9.9 linux-x64'), uv: `[ "$1" = tool ] && ${say('claude-swap v9.9.9')} || ${say('uv 0.9.0 (mise shim)')}` });
const installed = (env) => spawnSync(process.execPath, [path.join(imageKit, 'scripts', 'devteam.mjs'), 'box-pins', 'installed'], { cwd: nowhere, encoding: 'utf8', env: pinsEnv({ PATH: `${shimBin}${path.delimiter}${baseEnv.PATH}`, ...env }) });

test('box-pins installed reads each tool by its image path and claude-swap from the image\'s tool dir', () => {
  const r = installed({ DEVTEAM_BOX_BIN: boxBin, DEVTEAM_BOX_TOOLS: TOOLS_ENV });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.stdout.trim().split('\n'), ['claude-code: 2.1.307', 'claude-swap: 1.0.0', 'gh: 2.104.0', 'ttyd: 1.7.7', 'mise: v2026.10.17', 'uv: 0.13.7']);
  // the same from inside a worker's checkout, with its session's run folder: still the machine's command
  const w = installed({ DEVTEAM_BOX_BIN: boxBin, DEVTEAM_BOX_TOOLS: TOOLS_ENV, DEVTEAM_RUN: path.join(tmp, 'elsewhere', 'run') });
  assert.equal(w.status, 0, w.stderr);
});

test('installed exits 1 naming the tool that differs, or is missing', () => {
  const r = installed({ DEVTEAM_BOX_BIN: boxBin, DEVTEAM_BOX_TOOLS: TOOLS_ENV.replace('gh=2.104.0', 'gh=2.105.0') });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^gh: installed 2\.104\.0, pinned 2\.105\.0$/m);
  assert.match(r.stdout, /^uv: 0\.13\.7$/m);
  const partial = fakeBins('box-bin-no-ttyd', Object.fromEntries(['claude', 'gh', 'mise', 'uv'].map((f) => [f, `exec '${path.join(boxBin, f)}' "$@"`])));
  const m = installed({ DEVTEAM_BOX_BIN: partial, DEVTEAM_BOX_TOOLS: TOOLS_ENV });
  assert.equal(m.status, 1);
  assert.match(m.stdout, /^ttyd: did not run \(ENOENT\)$/m);
  const odd = installed({ DEVTEAM_BOX_BIN: boxBin, DEVTEAM_BOX_TOOLS: `${TOOLS_ENV.replace(' uv=0.13.7', '')} node=22.1.0` });
  assert.equal(odd.status, 1);
  assert.match(odd.stdout, /^uv: not in DEVTEAM_BOX_TOOLS$/m);
  assert.match(odd.stdout, /^node: not a tool box-pins knows$/m);
});

test('installed without DEVTEAM_BOX_TOOLS exits 2', () => {
  const r = installed({ DEVTEAM_BOX_BIN: boxBin });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /box-pins installed: DEVTEAM_BOX_TOOLS is not set \(not the box image\?\)/);
});

test('help names box-pins and says only the top package of npm and PyPI tools is pinned', () => {
  const r = spawnSync(process.execPath, [KIT, 'help'], { cwd: nowhere, encoding: 'utf8', env: pinsEnv() });
  assert.equal(r.status, 0, r.stderr);
  for (const re of [/box-pins verify \[--release vX\.Y\.Z\]/, /check \[--json\]/, /bump --release vX\.Y\.Z \[--dry-run\]/, /box-pins installed/, /only the top package of the npm and PyPI tools is pinned/i]) assert.match(r.stdout, re);
});
