// A test never writes into a session's run folder, and a kit refuses one outside its home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { bareProject, HARNESS_ENV, hasTmux, kit } from './lib/kit.mjs';
import { baseEnv, dtIn, REPO, tmp } from './lib/machine-fixture.mjs';

// A worker's session env, as a box gives it: its run folder, its home, its role and ticket, the box's
// address, its tmux pane. Pointed at a decoy, it shows whether a test can still write to the fleet.
const workerEnv = (decoy) => ({ DEVTEAM_RUN: path.join(decoy, 'run'), DEVTEAM_HOME: decoy, DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-1', DEVTEAM_FEATURE: 'x', DEVTEAM_SUPERVISOR: '%1', DEVTEAM_PUBLIC_URL: 'https://box.example.com', DEVTEAM_PREVIEWS: '1', TMUX: 'x', TMUX_PANE: '%9' });
const decoyOf = (name) => { const d = fs.mkdtempSync(path.join(tmp, `${name}-`)); fs.mkdirSync(path.join(d, 'run')); return d; };
const filesIn = (d) => fs.readdirSync(d, { recursive: true }).map(String).sort();

test('importing the test helper leaves no session\'s DEVTEAM_* or tmux in the environment, only the harness\'s own knobs', () => {
  const decoy = decoyOf('env-decoy');
  const env = { ...process.env, ...workerEnv(decoy), DEVTEAM_FORK: path.join(decoy, 'fork'), DEVTEAM_TEST_KEEP: '1' };
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('./lib/kit.mjs', import.meta.url).href)}); console.log(JSON.stringify(Object.keys(process.env).filter((k) => /^(DEVTEAM_|TMUX)/.test(k)).sort())); console.log(process.env.DEVTEAM_MEMORY_RECORD ?? 'unset')`], { cwd: tmp, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const said = r.stdout.trim().split('\n');
  const names = JSON.parse(said.at(-2));
  assert.deepEqual(names.filter((k) => !HARNESS_ENV.test(k)), ['DEVTEAM_BOX', 'DEVTEAM_CSWAP', 'DEVTEAM_HUB_PORT', 'DEVTEAM_MEMORY_RECORD', 'DEVTEAM_PORT_BASE', 'DEVTEAM_SUPERVISOR_UP', 'TMUX_TMPDIR']);
  // the hub's memory recorder is off in every kit a test starts, through a helper or not (kit-591)
  assert.equal(said.at(-1), 'off', 'DEVTEAM_MEMORY_RECORD is off');
  for (const k of ['DEVTEAM_FORK', 'DEVTEAM_TEST_KEEP', 'DEVTEAM_CGROUP', 'DEVTEAM_MEMINFO']) assert.ok(names.includes(k), `${k} survives: the harness reads it`);
  assert.deepEqual(filesIn(decoy), ['run']);
});

// The incident, as the supervisor reproduced it: from the kit's checkout, a worker's role and run
// folder and no home, the test that wrote the owner's rule into a live log at 21:46. (A loaded box
// runs that test in minutes, hence the wait.) It lives in machine.status.test.mjs, which loads only
// what its own tests need.
test('a worker\'s run folder gets nothing from the incident\'s own test, run as it was: a worker\'s DEVTEAM_RUN, no DEVTEAM_HOME', { skip: !hasTmux, timeout: 960000 }, () => {
  const decoy = fs.mkdtempSync(path.join(tmp, 'run-decoy-'));
  const env = { ...process.env, DEVTEAM_ROLE: 'worker', DEVTEAM_RUN: decoy };
  delete env.DEVTEAM_HOME;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern', 'status says at a glance', 'test/machine.status.test.mjs'], { cwd: REPO, env, encoding: 'utf8', timeout: 900000 });
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
