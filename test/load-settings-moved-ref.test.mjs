// A session can move its checkout's local refs without a push (kit-764): origin/main, origin/HEAD, a
// replace ref. A launch (worker, planner, recover, operator-thread start) reads the owner's settings from the commit origin itself names for main, so a moved ref never
// changes which command starts a session. With origin unreadable, a launch starts nothing and says
// why; every other command still works from the local refs, as before.
// Run: node --test test/load-settings-moved-ref.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { hasTmux, threadsFixture, until, write } from './lib/kit.mjs';
import { CLAUDE_RESUME, fixture as recoveryFixture, MENU, rateLimit, SID, SKIP, STUB_SHELL, SUP as SUP_PROMPT, supervisorPane, UNDER } from './lib/recovery-fixture.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const TICKET = 'mr-01-a';
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function fixture() {
  const F = threadsFixture('moved-ref');
  const sf = path.join(F.old, 'docs/devteam/project/settings.md');
  const edit = (patch) => {
    const text = fs.readFileSync(sf, 'utf8');
    const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    fs.writeFileSync(sf, text.replace(block[1], JSON.stringify({ ...JSON.parse(block[1]), ...patch }, null, 2)));
  };
  // a stand-in agent that records which command started it: own (the owner's) or evil (planted)
  const marks = path.join(F.base, 'marks');
  fs.mkdirSync(marks);
  const agent = (tag) => {
    const file = path.join(F.base, `agent-${tag}.mjs`);
    write(file, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(path.join(marks, tag))}, process.cwd() + '\\n');\nsetInterval(() => {}, 1000);\n`);
    return `${process.execPath} ${file}`;
  };
  const paneHome = path.join(F.base, 'pane-home');
  const standin = path.join(F.base, 'standin-bin');
  write(path.join(standin, 'claude'), `#!/bin/sh\necho "$*" >> '${path.join(marks, 'claude')}'\nexec sleep 3600\n`);
  fs.chmodSync(path.join(standin, 'claude'), 0o755);
  for (const f of ['.bash_profile', '.profile', '.bashrc']) write(path.join(paneHome, f), `PATH='${standin}':"$PATH"; export PATH\n`);
  const OWN = agent('own');
  const EVIL = agent('evil');
  const evilSetup = `touch ${JSON.stringify(path.join(marks, 'evil-setup'))}`;
  // the owner's settings, landed on origin's main as a PR would land them
  edit({ agent_command: OWN, resume_command: OWN });
  F.g(['commit', '-qam', 'settings: the owner\'s agent'], F.old);
  F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
  F.sup(['feature', 'add', 'movedref', '--json', JSON.stringify({ title: 'Moved ref', goals: [F.goal], stories: [{ id: 'MR-S1', text: 'launches read origin', release: 'v1.0.0' }] })]);
  F.sup(['ticket', 'add', TICKET, '--json', JSON.stringify({ title: TICKET, feature: 'movedref', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['MR-S1'], depends_on: [], touches: [`src/${TICKET}/**`], done_when: ['its test passes in CI'] })]);
  // a commit with the planted command (and a planted setup and an empty deny list), never pushed
  const planted = () => {
    edit({ agent_command: EVIL, resume_command: EVIL, worktree_setup: evilSetup, worker_denied_commands: [] });
    F.g(['commit', '-qam', 'planted'], F.old);
    const sha = F.g(['rev-parse', 'HEAD'], F.old);
    F.g(['reset', '-q', '--hard', 'HEAD~1'], F.old);
    return sha;
  };
  const run = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: F.old, env: { ...F.env(SUP), ...extra, HOME: paneHome, PATH: `${standin}${path.delimiter}${process.env.PATH}` }, encoding: 'utf8', timeout: 120000 });
    return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  };
  const session = F.sup(['settings', '--get', 'tmux_session']);
  const tmux = (args) => spawnSync('tmux', args, { env: F.env(), encoding: 'utf8' });
  const windows = () => (tmux(['list-windows', '-t', `=${session}`, '-F', '#W']).stdout ?? '').split('\n').filter(Boolean);
  const seen = (tag) => { try { return fs.readFileSync(path.join(marks, tag), 'utf8'); } catch { return ''; } };
  // the launch's agent, once it has run: own or evil, never both
  const started = () => {
    for (let i = 0; i < 300 && !seen('own') && !seen('evil') && !seen('claude'); i++) sleep(100);
    return { own: !!seen('own'), evil: !!seen('evil'), setup: fs.existsSync(path.join(marks, 'evil-setup')), ...(seen('claude') ? { claude: true } : {}) };
  };
  // each case starts clean: no window, no worktree, no mark
  const reset = () => {
    for (const w of windows()) tmux(['kill-window', '-t', `=${session}:${w}`]);
    for (const s of (tmux(['list-sessions', '-F', '#S']).stdout ?? '').split('\n').filter((n) => n.startsWith('devteam-home'))) tmux(['kill-session', '-t', `=${s}`]);
    for (const n of fs.readdirSync(marks)) fs.rmSync(path.join(marks, n));
    for (const n of [TICKET, 'plan-movedref']) {
      const wt = path.join(F.old, '.worktrees', n);
      if (fs.existsSync(wt)) F.g(['worktree', 'remove', '--force', wt], F.old);
    }
    for (const b of [`ticket/${TICKET}`, 'plan/movedref']) spawnSync('git', ['branch', '-q', '-D', b], { cwd: F.old });
    for (const f of [`launch-${TICKET}`]) fs.rmSync(path.join(F.old, 'docs/devteam/run', f), { recursive: true, force: true });
  };
  const onOrigin = (patch) => {
    const text = fs.readFileSync(sf, 'utf8');
    if (patch === undefined) return;
    const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    fs.writeFileSync(sf, text.replace(block[1], typeof patch === 'string' ? patch : JSON.stringify({ ...JSON.parse(block[1]), ...patch }, null, 2)));
    F.g(['commit', '-qam', 'on origin'], F.old);
    const sha = F.g(['rev-parse', 'HEAD'], F.old);
    F.g(['reset', '-q', '--hard', 'HEAD~1'], F.old);
    F.g(['push', '-q', '-f', 'origin', `${sha}:main`], F.old);
    return () => F.g(['push', '-q', '-f', 'origin', 'HEAD:main'], F.old);
  };
  return { ...F, edit, planted, run, windows, started, reset, onOrigin, OWN, EVIL };
}

test('a launch reads the owner\'s settings from origin, never from a local ref a session moved', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = fixture();
  const good = F.g(['rev-parse', 'origin/main'], F.old);
  // each way a session moves a ref without a push, and how it is put back
  const moves = {
    'origin/main moved': () => { F.g(['update-ref', 'refs/remotes/origin/main', F.planted()], F.old); return () => F.g(['update-ref', 'refs/remotes/origin/main', good], F.old); },
    'origin/HEAD repointed': () => {
      F.g(['update-ref', 'refs/heads/evil', F.planted()], F.old);
      const had = spawnSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: F.old, encoding: 'utf8' }).stdout.trim();
      F.g(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/heads/evil'], F.old);
      return () => {
        if (had) F.g(['symbolic-ref', 'refs/remotes/origin/HEAD', had], F.old); else spawnSync('git', ['symbolic-ref', '--delete', 'refs/remotes/origin/HEAD'], { cwd: F.old });
        F.g(['update-ref', '-d', 'refs/heads/evil'], F.old);
      };
    },
    'main\'s commit replaced': () => { F.g(['replace', good, F.planted()], F.old); return () => F.g(['replace', '-d', good], F.old); },
  };
  try {
    for (const [how, move] of Object.entries(moves)) {
      await t.test(`worker, ${how}: the owner's command starts it, the planted one and its setup never run`, () => {
        F.reset();
        const back = move();
        let r;
        try { r = F.run(['worker', TICKET]); } finally { back(); }
        assert.equal(r.status, 0, r.err);
        const s = F.started();
        assert.deepEqual(s, { own: true, evil: false, setup: false }, `${how}: ${r.err}`);
      });
    }
    await t.test('planner, origin/main moved: the owner\'s command starts it', () => {
      F.reset();
      const back = moves['origin/main moved']();
      let r;
      try { r = F.run(['planner', 'movedref', '--goal', F.goal]); } finally { back(); }
      assert.equal(r.status, 0, r.err);
      assert.deepEqual(F.started(), { own: true, evil: false, setup: false }, r.err);
    });
    await t.test('worker --resume, origin/main moved: the owner\'s resume command starts it', () => {
      F.reset();
      assert.equal(F.run(['worker', TICKET]).status, 0);
      F.started();
      for (const w of F.windows()) spawnSync('tmux', ['kill-window', '-t', `=${F.sup(['settings', '--get', 'tmux_session'])}:${w}`], { env: F.env() });
      for (const n of ['own', 'evil']) fs.rmSync(path.join(F.base, 'marks', n), { force: true });
      const back = moves['origin/main moved']();
      let r;
      try { r = F.run(['worker', TICKET, '--resume']); } finally { back(); }
      assert.equal(r.status, 0, r.err);
      assert.deepEqual(F.started(), { own: true, evil: false, setup: false }, r.err);
    });
    await t.test('operator-thread start (a laptop\'s operator, from this checkout), origin/main moved: the owner\'s command starts it', () => {
      F.reset();
      const back = moves['origin/main moved']();
      let r;
      try { r = F.run(['operator-thread', 'start'], { DEVTEAM_BOX: 'off', DEVTEAM_ROLE: '' }); } finally { back(); }
      assert.equal(r.status, 0, r.err);
      assert.match(r.out, /started fresh/);
      assert.deepEqual(F.started(), { own: true, evil: false, setup: false }, r.err);
    });
    await t.test('operator-thread new with no operator up (the owner\'s first words start it), origin/main moved: the owner\'s command starts it', () => {
      F.reset();
      const back = moves['origin/main moved']();
      let r;
      try { r = F.run(['operator-thread', 'new', 'what is stuck?'], { DEVTEAM_BOX: 'off', DEVTEAM_ROLE: '' }); } finally { back(); }
      assert.equal(r.status, 0, r.err);
      assert.match(r.out, /recorded; the operator is starting/);
      assert.deepEqual(F.started(), { own: true, evil: false, setup: false }, r.err);
    });
    await t.test('origin unreadable, origin/main moved: the worker starts nothing and says why', () => {
      F.reset();
      const url = F.g(['remote', 'get-url', 'origin'], F.old);
      const back = moves['origin/main moved']();
      F.g(['remote', 'set-url', 'origin', path.join(F.base, 'no-such-remote.git')], F.old);
      let r;
      try { r = F.run(['worker', TICKET]); } finally { F.g(['remote', 'set-url', 'origin', url], F.old); back(); }
      assert.notEqual(r.status, 0, 'refused');
      assert.match(r.err, /could not read main from origin \('[^']*no-such-remote\.git' does not appear to be a git repository\)/);
      assert.match(r.err, /nothing was started/);
      sleep(1000);
      assert.deepEqual(F.started(), { own: false, evil: false, setup: false });
      assert.ok(!F.windows().includes(TICKET), 'no window');
      assert.ok(!fs.existsSync(path.join(F.old, '.worktrees', TICKET)), 'no worktree');
    });
    await t.test('no origin remote at all, main moved: the worker starts nothing and says why', () => {
      F.reset();
      const url = F.g(['remote', 'get-url', 'origin'], F.old);
      F.g(['remote', 'remove', 'origin'], F.old);
      F.g(['update-ref', 'refs/heads/main', F.planted()], F.old);
      let r;
      try { r = F.run(['worker', TICKET]); } finally {
        F.g(['update-ref', 'refs/heads/main', good], F.old);
        F.g(['remote', 'add', 'origin', url], F.old);
        F.g(['fetch', '-q', 'origin'], F.old);
      }
      assert.notEqual(r.status, 0, 'refused');
      assert.match(r.err, /could not read main from origin \('origin' does not appear to be a git repository\)/);
      assert.match(r.err, /nothing was started/);
      sleep(1000);
      assert.deepEqual(F.started(), { own: false, evil: false, setup: false });
      assert.ok(!F.windows().includes(TICKET), 'no window');
      assert.ok(!fs.existsSync(path.join(F.old, '.worktrees', TICKET)), 'no worktree');
    });
    for (const [what, block] of [['null', 'null'], ['an array', '[]'], ['{}', '{}']]) {
      await t.test(`origin's settings block is ${what}: the worker starts nothing, never the kit's defaults`, () => {
        F.reset();
        const back = F.onOrigin(block);
        let r;
        try { r = F.run(['worker', TICKET]); } finally { back(); }
        assert.notEqual(r.status, 0, 'refused');
        assert.match(r.err, /nothing was started/);
        sleep(1000);
        assert.deepEqual(F.started(), { own: false, evil: false, setup: false });
      });
    }
    await t.test('origin\'s default branch is not the main_branch its settings name: the worker starts nothing', () => {
      F.reset();
      const back = F.onOrigin({ main_branch: 'trunk', agent_command: F.EVIL });
      let r;
      try { r = F.run(['worker', TICKET]); } finally { back(); }
      assert.notEqual(r.status, 0, 'refused');
      assert.match(r.err, /names trunk as main/);
      sleep(1000);
      assert.deepEqual(F.started(), { own: false, evil: false, setup: false });
    });
    await t.test('origin unreadable: a command that starts no session works as before, from the local refs', () => {
      const url = F.g(['remote', 'get-url', 'origin'], F.old);
      F.g(['remote', 'set-url', 'origin', path.join(F.base, 'no-such-remote.git')], F.old);
      let r, v;
      try { r = F.run(['settings', '--get', 'main_branch']); v = F.run(['status']); } finally { F.g(['remote', 'set-url', 'origin', url], F.old); }
      assert.equal(r.status, 0, r.err);
      assert.equal(r.out, 'main');
      assert.equal(v.status, 0, v.err || v.out);
    });
  } finally {
    F.done();
  }
});

// An offline boot doesn't leave a fleet down for good (a-20261122-164700129-supervisor): a relaunch
// or a supervisor start refused while origin is unreadable says why and starts nothing, and the next
// accounts-tick that is due, or the next recover, starts it once origin answers.
test('origin unreadable at a relaunch or a recover: refused with the reason, and the next pass once origin answers starts it with the owner\'s command', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = recoveryFixture('origin-back');
  const g = (args) => spawnSync('git', args, { cwd: F.root, encoding: 'utf8' }).stdout.trim();
  const url = g(['remote', 'get-url', 'origin']);
  const down = () => g(['remote', 'set-url', 'origin', path.join(F.base, 'no-such-remote.git')]);
  const up = () => g(['remote', 'set-url', 'origin', url]);
  try {
    await t.test('accounts-tick: refused while origin is down, relaunched by the next due tick once it answers', async () => {
      F.worker('demo-01-a');
      down();
      let said;
      try { said = F.tick(UNDER(F)); } finally { up(); }
      assert.match(said, /could not relaunch demo-01-a: [\s\S]*could not read main from origin/);
      sleep(1000);
      assert.deepEqual(F.relaunched(), [], 'nothing started');
      assert.ok(!F.windows().includes('demo-01-a'), 'no window');
      // the attempt it spent, 11 minutes ago: the next one is due
      write(F.restartsFile, JSON.stringify({ 'demo-01-a': [Date.now() - 11 * 60000] }));
      assert.match(F.tick(UNDER(F)), /relaunched demo-01-a/);
      await until(() => F.relaunched().length === 1, 'relaunched with the owner\'s resume_command');
    });
    await t.test('accounts-tick, origin hung: the relaunch refuses with "did not answer in time" inside the tick, never killed by it', async () => {
      F.worker('demo-02-b');
      const pidFile = path.join(F.base, 'transport.pid');
      const hang = path.join(F.base, 'hang-ssh.sh');
      fs.writeFileSync(hang, `#!/bin/sh\nsleep 300 &\necho $! > '${pidFile}'\nwait\n`, { mode: 0o755 });
      g(['remote', 'set-url', 'origin', 'ssh://probe.invalid/x.git']);
      g(['config', 'core.sshCommand', hang]);
      let said;
      try { said = F.tick({ ...UNDER(F), DEVTEAM_LAUNCH_ORIGIN_MS: '2500' }); } finally { g(['config', '--unset', 'core.sshCommand']); up(); }
      assert.match(said, /could not relaunch demo-02-b: [\s\S]*could not read main from origin \(it did not answer in time\)/);
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      const alive = () => { const st = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim(); return !!st && !st.startsWith('Z'); };
      for (let i = 0; i < 50 && alive(); i++) sleep(100);
      const left = alive();
      if (left) process.kill(pid, 'SIGKILL');
      assert.ok(!left, 'the transport process is gone');
      assert.deepEqual(F.relaunched().filter((n) => n === 'demo-02-b'), [], 'nothing started');
    });
    await t.test('accounts-tick, origin hung, the tick\'s own deadline near: the relaunch refuses before it, not after the 30 s', () => {
      F.worker('demo-03-c');
      const hang = path.join(F.base, 'hang-ssh-2.sh');
      fs.writeFileSync(hang, '#!/bin/sh\nexec sleep 300\n', { mode: 0o755 });
      g(['remote', 'set-url', 'origin', 'ssh://probe.invalid/x.git']);
      g(['config', 'core.sshCommand', hang]);
      // no DEVTEAM_LAUNCH_ORIGIN_MS: only the deadline the tick hands its child bounds the wait
      const t0 = Date.now();
      let said;
      try { said = F.tick({ ...UNDER(F), DEVTEAM_SETUP_DEADLINE: String(Date.now() + 12000) }); } finally { g(['config', '--unset', 'core.sshCommand']); up(); }
      const took = Date.now() - t0;
      assert.match(said, /could not relaunch demo-03-c: [\s\S]*could not read main from origin \(it did not answer in time\)/);
      assert.ok(took < 25000, `refused inside the deadline the tick gave (${took} ms), not after the launch's own 30 s`);
      assert.deepEqual(F.relaunched().filter((n) => n === 'demo-03-c'), [], 'nothing started');
    });
    // the supervisor's start, as box-recover's child recover runs it, on a tmux server of its own
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-kit764-'));
    const server = { TMUX_TMPDIR: dir, SHELL: STUB_SHELL, DEVTEAM_ROLE: '', DEVTEAM_CSWAP: 'off' };
    // the box's session is up before box-recover runs (it holds the operator); here, a window that idles
    const tmuxP = (args) => spawnSync('tmux', args, { env: { ...process.env, TMUX_TMPDIR: dir, SHELL: STUB_SHELL }, encoding: 'utf8' });
    const recover = () => {
      if (tmuxP(['has-session', '-t', '=kit764']).status !== 0) { tmuxP(['new-session', '-d', '-s', 'kit764', '-n', 'hold', 'sleep 3600']); tmuxP(['set-option', '-g', 'default-shell', STUB_SHELL]); }
      return F.run(['recover', '--force', '--session', 'kit764', '--window', 'sup'], server);
    };
    try {
      await t.test('recover, origin unreadable: says why and starts nothing; the next recover once origin answers starts it', async () => {
        down();
        let r;
        try { r = recover(); } finally { up(); }
        assert.notEqual(r.status, 0, 'refused');
        assert.match(r.stderr, /could not read main from origin/);
        sleep(1000);
        assert.deepEqual(F.claudeCalls(), [], 'no supervisor started');
        const t0 = Date.now();
        const again = recover();
        assert.ok(Date.now() - t0 < 30000, `the next recover ran at once (${Date.now() - t0} ms), not after a lock the refusal left`);
        assert.equal(again.status, 0, `${again.stderr}|${again.stdout}`);
        await until(() => F.claudeCalls().length === 1, 'the supervisor started');
      });
      await t.test('recover, origin unreadable, the supervisor already up: "already running", as before', () => {
        down();
        let r;
        try { r = recover(); } finally { up(); }
        assert.equal(r.status, 0, `${r.stderr}|${r.stdout}`);
        assert.match(r.stdout, /^already running/);
      });
      await t.test('recover, origin unreadable, the supervisor stopped on purpose: "left stopped", as before', () => {
        spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR: dir } });
        const upFile = path.join(F.root, 'docs/devteam/run/supervisor-up.json');
        write(upFile, JSON.stringify({ up: false, at: new Date().toISOString() }));
        down();
        let r;
        try { r = F.run(['recover', '--session', 'kit764', '--window', 'sup'], server); } finally { up(); }
        assert.equal(r.status, 0, `${r.stderr}|${r.stdout}`);
        assert.match(r.stdout, /^left stopped \(stopped before the restart/);
        assert.deepEqual(F.claudeCalls().length, 1, 'nothing more started');
      });
      await t.test('recover --was-up (box-recover\'s child), origin unreadable, a record that would leave it stopped: refused before the lock, none left behind', () => {
        const upFile = path.join(F.root, 'docs/devteam/run/supervisor-up.json');
        write(upFile, JSON.stringify({ up: false, at: new Date().toISOString() }));
        down();
        let r;
        try { r = F.run(['recover', '--was-up', '--session', 'kit764', '--window', 'sup'], server); } finally { up(); }
        assert.notEqual(r.status, 0, 'refused');
        assert.match(r.stderr, /could not read main from origin/);
        assert.ok(!fs.existsSync(path.join(F.root, 'docs/devteam/run/recover.lock')), 'no recover lock left behind');
        assert.deepEqual(F.claudeCalls().length, 1, 'nothing more started');
      });
      await t.test('recover, origin/main moved: the owner\'s command starts the supervisor', async () => {
        spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR: dir } });
        fs.rmSync(path.join(F.root, '.claude-calls'), { force: true });
        fs.rmSync(path.join(F.root, 'docs/devteam/run/supervisor-up.json'), { force: true });
        const sf = path.join(F.root, 'docs/devteam/project/settings.md');
        const text = fs.readFileSync(sf, 'utf8');
        fs.writeFileSync(sf, text.replace('"project":', '"agent_command": "claude --planted",\n  "project":'));
        g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'planted']);
        const planted = g(['rev-parse', 'HEAD']);
        g(['reset', '-q', '--hard', 'HEAD~1']);
        const good = g(['rev-parse', '--verify', 'origin/main^{commit}']);
        assert.match(good, /^[0-9a-f]{40}$/, 'origin/main is there to put back');
        g(['update-ref', 'refs/remotes/origin/main', planted]);
        let r;
        try { r = recover(); } finally { g(['update-ref', 'refs/remotes/origin/main', good]); }
        assert.equal(r.status, 0, `${r.stderr}|${r.stdout}`);
        await until(() => F.claudeCalls().length === 1, 'the supervisor started');
        assert.doesNotMatch(F.claudeCalls()[0], /--planted/);
        assert.match(F.claudeCalls()[0], /^supervisor\|--dangerously-skip-permissions /);
      });
    } finally {
      spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR: dir } });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally { F.done(); }
});

// accounts-tick isn't a launch, but it types the supervisor's resume_command into its pane after a
// usage limit (restartSupervisor): that command too is origin's, and a refused read restarts nothing.
test('accounts-tick restarts a supervisor stopped at a limit with origin\'s resume_command, and not at all while origin is unreadable', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const cswap = (F) => ({ DEVTEAM_CSWAP: F.cswap });
  const stopped = async (F) => {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP_PROMPT } }, rateLimit()]);
    const pane = supervisorPane(F, MENU, { args: SKIP });
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
    // the first tick: this project has not seen the account settle
    assert.equal(F.tick(cswap(F)), '');
    return pane;
  };
  await t.test('origin/HEAD repointed at an unpushed commit with another resume_command: the owner\'s is typed', async () => {
    const F = recoveryFixture('origin-suprestart', { resume: CLAUDE_RESUME });
    const g = (args) => spawnSync('git', args, { cwd: F.root, encoding: 'utf8' }).stdout.trim();
    try {
      const pane = await stopped(F);
      const sf = path.join(F.root, 'docs/devteam/project/settings.md');
      const text = fs.readFileSync(sf, 'utf8');
      fs.writeFileSync(sf, text.replace(JSON.stringify(CLAUDE_RESUME), JSON.stringify('claude --continue --planted')));
      g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'planted']);
      const planted = g(['rev-parse', 'HEAD']);
      g(['reset', '-q', '--hard', 'HEAD~1']);
      g(['update-ref', 'refs/remotes/origin/planted', planted]);
      g(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/planted']);
      assert.match(F.tick(cswap(F)), /restarted the supervisor/);
      await until(() => F.claudeCalls().length === 1, 'the stand-in claude ran');
      assert.equal(F.claudeCalls()[0], `supervisor|--resume ${SID} --dangerously-skip-permissions You were restarted after a usage limit, on this same conversation. Carry on from where you were.`);
      assert.equal(pane.keys(), '', 'no key reaches the old process');
    } finally { F.done(); }
  });
  await t.test('origin unreadable: not restarted, the tick says why, nothing typed and no attempt spent', async () => {
    const F = recoveryFixture('origin-supdown', { resume: CLAUDE_RESUME });
    const g = (args) => spawnSync('git', args, { cwd: F.root, encoding: 'utf8' }).stdout.trim();
    try {
      const pane = await stopped(F);
      g(['remote', 'set-url', 'origin', path.join(F.base, 'no-such-remote.git')]);
      const said = F.tick(cswap(F));
      assert.match(said, /the supervisor is stopped at a usage limit and was not restarted: could not read main from origin \('[^']*no-such-remote\.git' does not appear to be a git repository\)/);
      sleep(1000);
      assert.deepEqual(F.claudeCalls(), [], 'nothing started');
      assert.equal(pane.keys(), '', 'nothing typed');
      assert.ok(!fs.existsSync(F.restartsFile) || !/"supervisor"/.test(fs.readFileSync(F.restartsFile, 'utf8')), 'no attempt spent');
    } finally { F.done(); }
  });
});
