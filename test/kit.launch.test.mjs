import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture, hasTmux, until } from './lib/kit.mjs';

// A prompt reaches the agent as a file it is told to read, never as one argument: Linux caps one
// argument at 128 KB (MAX_ARG_STRLEN), and a worker whose knowledge block passed that never started.
test('a launch hands its agent a short pointer to the prompt file, fresh and resumed, however large the prompt', { skip: hasTmux ? false : 'no tmux' }, async () => {
  const F = threadsFixture('prompt-file');
  try {
    // a stand-in agent, not claude: it records what it was given and reads the file it was pointed at
    const agent = path.join(F.base, 'agent.mjs');
    const calls = path.join(F.base, 'calls.jsonl');
    fs.writeFileSync(agent, `import fs from 'node:fs';
const args = process.argv.slice(2);
const named = /\\/\\S*?\\.txt/.exec(args[0] ?? '')?.[0];
let read = null;
try { read = named ? fs.readFileSync(named).length : null; } catch (e) { read = String(e); }
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ lens: args.map((a) => Buffer.byteLength(a)), first: Buffer.byteLength(args[0] ?? '') < 4096 ? args[0] : null, named, read }) + '\\n');
setInterval(() => {}, 1e6);
`);
    const sf = path.join(F.old, 'docs/devteam/project/settings.md');
    const cmd = JSON.stringify(`${process.execPath} ${agent}`);
    const was = fs.readFileSync(sf, 'utf8');
    assert.ok(was.includes('"agent_command": "true", "resume_command": "true"'));
    fs.writeFileSync(sf, was.replace('"agent_command": "true", "resume_command": "true"', `"agent_command": ${cmd}, "resume_command": ${cmd}`));
    F.g(['commit', '-qm', 'settings', '--', 'docs/devteam/project/settings.md'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    // 64 accepted lessons of 3,500 bytes each: a prompt of over 200 KB
    for (let i = 0; i < 64; i++) {
      const statement = `Lesson ${i}: ${'keep every prompt readable. '.repeat(130)}`.slice(0, 3500);
      F.hand('supervisor', { id: `k-20261101-100000${String(i).padStart(3, '0')}-supervisor`, type: 'knowledge', kind: 'lesson', statement, scope: 'all', status: 'accepted', evidence: [] }, 3600000 - i * 10);
    }
    const prompt = path.join(F.old, 'docs/devteam/run/prompts/plan-big.txt');
    const lines = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    const tmuxOut = (args) => spawnSync('tmux', args, { env: F.env(), encoding: 'utf8' }).stdout ?? '';
    const started = async (n, target) => until(() => {
      const pane = tmuxOut(['capture-pane', '-p', '-t', target]);
      if (/Argument list too long/.test(pane)) assert.fail(`the shell refused the agent's command line:\n${pane}`);
      return lines().length >= n;
    }, `launch ${n} of the stand-in agent`);
    const check = (call, how) => {
      const size = fs.statSync(prompt).size;
      assert.ok(size > 200 * 1024, `${how}: the prompt file holds the whole prompt (${size} bytes)`);
      assert.match(fs.readFileSync(prompt, 'utf8'), /accepted knowledge\):\n- \[lesson\] Lesson 0: [\s\S]*Lesson 63: /);
      assert.equal(call.lens.length, 1, `${how}: one argument`);
      assert.ok(call.lens.every((n) => n < 131072), `${how}: no argument reaches the per-argument limit`);
      assert.ok(call.lens[0] < 1024, `${how}: a short message (${call.lens[0]} bytes)`);
      // the kit names the file from its own root, the real path (a temp dir may be a symlink: macOS's /var)
      assert.ok([prompt, fs.realpathSync(prompt)].some((p) => call.first === `Your prompt for this session is in the file ${p}. Read all of it now, every part (a long file takes more than one read), and follow it.`), call.first);
      assert.ok(path.isAbsolute(call.named));
      assert.equal(call.read, size, `${how}: the agent read the whole file`);
    };
    const made = F.sup(['planner', 'big', '--goal', F.goal]);
    const target = `=${/made planner plan-big in (\S+):plan-big/.exec(made)?.[1]}:plan-big`;
    await started(1, target);
    check(lines()[0], 'fresh');
    // a resume rewrites the same full prompt: it gets the pointer too
    spawnSync('tmux', ['kill-window', '-t', target], { env: F.env() });
    assert.match(F.sup(['planner', 'big', '--resume']), /resumed planner plan-big/);
    await started(2, target);
    check(lines()[1], 'resumed');
  } finally {
    spawnSync('tmux', ['kill-server'], { env: F.env() });
    F.done();
  }
});

// A new worktree is a folder the agent has never run in: Claude Code 2.1 puts up its folder-trust
// dialog there and waits. The pane shows it as a prompt; agent_trust_command clears it before launch.
test('a folder-trust dialog in a new session\'s pane is a blocked prompt, and agent_trust_command clears it before launch', { skip: hasTmux ? false : 'no tmux' }, async () => {
  const F = threadsFixture('trust');
  // tmux reads the pane as UTF-8 only under a UTF-8 locale (❯, │); this test's calls only
  const U = { LANG: process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8' };
  const SUPU = { ...F.SUP, ...U };
  // stdout and stderr both, under the threads env (no DEVTEAM_SUPERVISOR from the session running the tests)
  const run = (args, role) => { const r = spawnSync(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: F.old, env: F.env(role), encoding: 'utf8' }); return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
  try {
    const screen = path.join(F.base, 'screen.txt');
    const trusted = path.join(F.base, 'trusted.txt');
    const calls = path.join(F.base, 'calls.jsonl');
    const agent = path.join(F.base, 'agent.mjs');
    const trustSh = path.join(F.base, 'trust.sh');
    // a stand-in agent: it shows the dialog unless trusted.txt names its own folder, as Claude Code does
    fs.writeFileSync(agent, `import fs from 'node:fs';
const cwd = fs.realpathSync(process.cwd());
let named = null;
try { named = fs.readFileSync(${JSON.stringify(trusted)}, 'utf8').split('\\n')[0]; } catch {}
const ok = named === cwd;
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ cwd, trusted: ok }) + '\\n');
process.stdout.write(ok ? 'ready\\n' : fs.readFileSync(${JSON.stringify(screen)}, 'utf8'));
setInterval(() => {}, 1e6);
`);
    fs.writeFileSync(trustSh, `printf '%s\\n%s\\n' "$DEVTEAM_WORKTREE" "$PWD" > ${JSON.stringify(trusted)}; echo hook-out\n`);
    const sf = path.join(F.old, 'docs/devteam/project/settings.md');
    const setSettings = (from, to, msg) => {
      const was = fs.readFileSync(sf, 'utf8');
      assert.ok(was.includes(from), `settings.md holds ${from}`);
      fs.writeFileSync(sf, was.replace(from, to));
      F.g(['commit', '-qm', msg, '--', 'docs/devteam/project/settings.md'], F.old);
      F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    };
    const cmd = JSON.stringify(`${process.execPath} ${agent}`);
    setSettings('"agent_command": "true", "resume_command": "true"', `"agent_command": ${cmd}, "resume_command": ${cmd}`, 'stand-in agent');
    const lines = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    const tmuxOut = (args) => spawnSync('tmux', args, { env: F.env(U), encoding: 'utf8' }).stdout ?? '';
    let target = null;
    // launch n of the agent, and its pane showing `shows`
    const started = async (n, shows) => until(() => lines().length >= n && tmuxOut(['capture-pane', '-p', '-t', target]).includes(shows), `launch ${n} showing ${shows}`);
    const finding = () => JSON.parse(F.sup(['metrics', '--json'], U)).findings.find((f) => f.kind === 'blocked-prompt' && f.subject === 'plan-big');
    const dialog = [
      '────────────────────────────────────────',
      ' Accessing workspace:',
      '',
      ' /some/fresh/worktree',
      '',
      " Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this folder first.",
      '',
      " Claude Code'll be able to read, edit, and execute files here.",
      '',
      ' Security guide',
      '',
      ' ❯ No, exit',
      '   Yes, I trust this folder',
      '',
      ' Enter to confirm · Esc to cancel',
      '',
    ].join('\n');
    // the dialog, no hook: one metrics pass names the session and the dialog's line
    fs.writeFileSync(screen, dialog);
    const made = F.sup(['planner', 'big', '--goal', F.goal], U);
    assert.match(made, /made planner plan-big in \S+:plan-big/);
    target = `=${/made planner plan-big in (\S+):plan-big/.exec(made)?.[1]}:plan-big`;
    await started(1, 'Enter to confirm');
    assert.equal(lines()[0].trusted, false);
    const f1 = finding();
    assert.ok(f1, 'a folder-trust dialog is a blocked prompt');
    assert.match(f1.detail, /^waiting on a prompt in its pane: "Quick safety check:/);
    // other screens, each through the pane after a fresh launch
    let n = 1;
    const relaunch = async (text, last, role = SUPU) => {
      if (text !== null) fs.writeFileSync(screen, text);
      spawnSync('tmux', ['kill-window', '-t', target], { env: F.env(U) });
      const r = run(['planner', 'big', '--resume'], role);
      assert.equal(r.status, 0, r.err);
      await started(++n, last);
      return r;
    };
    // already matched on main (❯ 1. Yes): kept as a regression guard
    await relaunch('Trust this folder?\n❯ 1. Yes, I trust this folder\n  2. No, exit\n', 'No, exit');
    assert.ok(finding(), 'a numbered option');
    await relaunch('│ Quick safety check: Is this a project you trust?        │\n│ ❯ No, exit                                         │\n', 'No, exit');
    assert.match(finding()?.detail ?? '', /Quick safety check/, 'inside a box');
    await relaunch('I read the ticket: the dialog says Yes, I trust this folder, and I answered it.\n', 'answered it');
    assert.equal(finding(), undefined, 'a mention mid-line is not a dialog');
    await relaunch(`${dialog}✻ Reading… (esc to interrupt)\n`, 'esc to interrupt');
    assert.equal(finding(), undefined, 'the dialog\'s text under a busy agent is its output, not its dialog');
    // the hook: run in the worktree before launch, so the dialog never shows
    fs.writeFileSync(screen, dialog);
    setSettings(`"resume_command": ${cmd}`, `"resume_command": ${cmd}, "agent_trust_command": ${JSON.stringify(`sh ${trustSh}`)}`, 'trust hook');
    const r = await relaunch(null, 'ready');
    const wt = fs.realpathSync(path.join(F.old, '.worktrees', 'plan-big'));
    const [named, pwd] = fs.readFileSync(trusted, 'utf8').split('\n');
    assert.equal(named, wt, 'DEVTEAM_WORKTREE is the worktree\'s real path');
    assert.equal(fs.realpathSync(pwd), wt, 'the hook runs in the worktree');
    assert.match(r.out, /resumed planner plan-big/);
    assert.doesNotMatch(r.out, /hook-out/, 'the hook prints to stderr, not the launch\'s stdout');
    assert.match(r.err, /hook-out/);
    assert.equal(lines().at(-1).trusted, true);
    assert.equal(finding(), undefined, 'trusted before launch: no dialog, no finding');
    // a failing hook warns and the launch goes on; the finding still shows the dialog
    setSettings(`"agent_trust_command": ${JSON.stringify(`sh ${trustSh}`)}`, '"agent_trust_command": "exit 3"', 'failing hook');
    fs.rmSync(trusted);
    const r2 = await relaunch(null, 'Enter to confirm');
    assert.match(r2.err, /agent_trust_command failed/);
    assert.ok(finding(), 'no trust, the dialog, the finding');
    // the hook is the owner's: a chore that changes it needs a governance-edit answer
    const w = path.join(F.old, '.worktrees', 'chore-trust');
    F.g(['worktree', 'add', '-q', '-b', 'chore-trust', w, 'origin/main'], F.old);
    const cf = path.join(w, 'docs/devteam/project/settings.md');
    fs.writeFileSync(cf, fs.readFileSync(cf, 'utf8').replace('"agent_trust_command": "exit 3"', '"agent_trust_command": "true"'));
    F.g(['commit', '-qam', 'trust hook'], w);
    F.g(['push', '-q', 'origin', 'chore-trust'], w);
    const body = path.join(F.base, 'body.md');
    fs.writeFileSync(body, '## One-way doors\n\nNone.\n');
    const merge = (...extra) => run(['merge', '--chore', 'trust', '--dry-run', '--title', 'chore-trust: trust hook', '--body-file', body, ...extra], F.SUP);
    const refused = merge();
    assert.notEqual(refused.status, 0);
    assert.match(refused.out + refused.err, /changes owner settings: agent_trust_command \(governance-edit\)/);
    const q = F.sup(['ask', '--question', 'Change the trust hook?', '--class', 'governance-edit', '--reasons', 'owner-only', '--recommendation', 'yes']);
    F.owner(['answer', q, 'yes']);
    const ok = merge('--approved', q);
    assert.equal(ok.status, 0, ok.err || ok.out);
  } finally {
    spawnSync('tmux', ['kill-server'], { env: F.env() });
    F.done();
  }
});
