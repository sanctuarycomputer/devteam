// recover: a supervisor brought back after a dead machine, and the command when it can't be.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasTmux, json, until, write } from './lib/kit.mjs';
import { CLAUDE_RESUME, findings, fixture, HOME, OFF, rateLimit, SID, SKIP, sleepMs, STUB_SHELL, SUP, supervisorPane, tmuxShim } from './lib/recovery-fixture.mjs';

test('a supervisor that can\'t be restarted: the finding and fleet status give the exact command', () => {
  const F = fixture('supcmd', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    F.tick(OFF);
    const f = findings(F).find((x) => x.kind === 'supervisor-at-limit');
    assert.ok(f);
    assert.ok(f.suggestion.includes(`claude --resume ${SID}`), f.suggestion);
    // a read writes nothing: the line only names the Stop hook's file once a start has written it
    const hook = path.join(F.root, 'docs/devteam/run/agent/supervisor-claude.json');
    assert.ok(!fs.existsSync(hook), 'the finding wrote no file');
    assert.doesNotMatch(f.suggestion, /dangerously-skip-permissions/, 'no running process to take it from: left out');
    assert.ok(f.suggestion.includes('DEVTEAM_ROLE=supervisor'), f.suggestion);
    // a dead machine, not at a limit: fleet status still says how to bring the supervisor back
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, { type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text: 'working' }] } }]);
    const shown = F.run(['fleet', 'status', '--no-fetch'], { DEVTEAM_ROLE: '' });
    assert.match(shown.stdout, new RegExp(`recovery .*claude --resume ${SID}`), shown.stderr);
    assert.ok(json(F.run(['fleet', 'status', '--no-fetch', '--json'], { DEVTEAM_ROLE: '' }).stdout).recovery.endsWith(`claude --resume ${SID}`));
    assert.ok(!fs.existsSync(hook), 'nor did fleet status');
    // once a start has written it, the by-hand line carries it too (supervisor.md §6, Every ask is an Inbox question)
    write(hook, '{}\n');
    assert.ok(F.run(['fleet', 'status', '--no-fetch'], { DEVTEAM_ROLE: '' }).stdout.includes(`claude --settings '${path.join(fs.realpathSync(F.root), 'docs/devteam/run/agent/supervisor-claude.json')}' --resume ${SID}`));
    assert.ok(json(F.run(['fleet', 'status', '--no-fetch', '--json'], { DEVTEAM_ROLE: '' }).stdout).recovery.endsWith(`supervisor-claude.json' --resume ${SID}`));
    assert.equal(fs.readFileSync(hook, 'utf8'), '{}\n', 'and leaves it as it was');
    assert.equal(F.run(['supervisor-session'], { DEVTEAM_ROLE: '' }).stdout, `${SID}\n`, 'stdout stays the bare id: the box\'s boot reads it');
  } finally { F.done(); }
});

// The Stop hook's file is written before recover claims the start: a write that fails leaves no claim
// behind, so the next recover doesn't answer "brought back moments ago" for a start that never was.
test('recover: a failed write of the Stop hook claims no start', () => {
  const F = fixture('rechook', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, { type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text: 'working' }] } }]);
    write(path.join(F.root, 'docs/devteam/run/agent'), 'a file where its folder goes\n');
    const r = F.run(['recover', '--force'], { DEVTEAM_ROLE: '', DEVTEAM_CSWAP: 'off', DEVTEAM_MACHINE_EPOCH: 'boot2' });
    assert.notEqual(r.status, 0, 'the write failed');
    const up = path.join(F.root, 'docs/devteam/run/supervisor-up.json');
    assert.ok(!fs.existsSync(up) || !json(fs.readFileSync(up, 'utf8')).starting, `no start claimed: ${fs.existsSync(up) ? fs.readFileSync(up, 'utf8') : ''}`);
    assert.deepEqual(F.claudeCalls(), [], 'nothing started');
  } finally { F.done(); }
});

// recover: a machine that came back, on real tmux, with stand-in agents. boot1 is the machine that
// ran; boot2 is the machine after it died.
const asOwner = { DEVTEAM_ROLE: '', DEVTEAM_CSWAP: 'off', DEVTEAM_MACHINE_EPOCH: 'boot2' };
const recover = (F, args = [], env = {}) => F.run(['recover', ...args], { ...asOwner, ...env });
const upFile = (F) => path.join(F.root, 'docs/devteam/run/supervisor-up.json');
const upRecord = (F) => json(fs.readFileSync(upFile(F), 'utf8'));
// the supervisor up and seen by a tick on the first boot; its pane left open for the caller
const seenUp = async (F, { skip = false } = {}) => {
  const pane = supervisorPane(F, ['SUP-UP'], { prefix: 'DEVTEAM_ROLE=supervisor ', shell: true, args: skip ? SKIP : '' });
  await until(() => pane.shows().includes('SUP-UP'), 'the stand-in supervisor');
  F.tick({ ...OFF, DEVTEAM_MACHINE_EPOCH: 'boot1' });
  return pane;
};
const privateServer = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-recover-')); return { dir, env: { TMUX_TMPDIR: dir, SHELL: STUB_SHELL }, done: () => { spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR: dir } }); fs.rmSync(dir, { recursive: true, force: true }); } }; };
const sessionTranscript = (F) => F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, { type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text: 'working' }] } }]);

test('recover: a dead machine with no tmux server brings the supervisor back on its exact conversation, with the permissions it had, once', { skip: !hasTmux }, async () => {
  const F = fixture('recdead', { resume: CLAUDE_RESUME });
  const server = privateServer();
  try {
    sessionTranscript(F);
    await seenUp(F, { skip: true });
    assert.deepEqual([upRecord(F).kind, upRecord(F).up, upRecord(F).skip], ['tmux', true, true], 'what the tick saw of the running process');
    F.killSession();
    const dry = recover(F, ['--dry-run'], server.env);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, new RegExp(`^would resume session ${SID}`));
    assert.notEqual(spawnSync('tmux', ['has-session'], { env: { ...process.env, TMUX_TMPDIR: server.dir } }).status, 0, 'a dry run starts no server');
    const did = recover(F, [], server.env);
    assert.equal(did.status, 0, did.stderr);
    assert.match(did.stdout, new RegExp(`^resumed session ${SID}`));
    const noted = ['supervisor-pane', 'supervisor-pane-role'].map((n) => fs.readFileSync(path.join(F.root, 'docs/devteam/run', n), 'utf8'));
    assert.match(noted[0], /^%\d+$/);
    assert.equal(noted[1], noted[0], 'recorded for the supervisor, marked as made for it');
    await until(() => F.claudeCalls().length === 1, 'the stand-in claude ran');
    // with its Stop hook (supervisor.md §6, Every ask is an Inbox question): the policy recover wrote
    assert.match(F.claudeCalls()[0], /^supervisor\|--settings \S+\/run\/agent\/supervisor-claude\.json /, F.claudeCalls()[0]);
    assert.match(fs.readFileSync(path.join(F.root, 'docs/devteam/run/agent/supervisor-claude.json'), 'utf8'), /devteam\.mjs' stop-ok --supervisor"/, 'its hook says whose window it is');
    assert.match(fs.readFileSync(path.join(F.root, 'docs/devteam/run/agent/supervisor-claude.json'), 'utf8'), /"matcher": "Bash"[\s\S]*devteam\.mjs' bash-ok"/, 'and the inline-rm guard, which a subagent of its runs under too');
    assert.ok(F.claudeCalls()[0].replace(/--settings \S+ /, '').startsWith(`supervisor|--resume ${SID} --dangerously-skip-permissions This machine restarted`), F.claudeCalls()[0]);
    assert.match(F.claudeCalls()[0], /Nothing about this restart came from the owner/, 'it carries no owner authority');
    assert.match(F.claudeCalls()[0], /keep the loop, as before the restart: run the tick \(§3\) now, then wait with devteam\.mjs wait and tick again when it returns, until the owner stops you\. A summary to the owner doesn't end it\.$/, 'and it ends by keeping the loop, never at a summary');
    const again = recover(F, [], server.env);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already running/);
    sleepMs(300);
    assert.equal(F.claudeCalls().length, 1, 'safe to run twice: no second one');
    assert.equal(upRecord(F).machine, 'boot2', 'the record is this boot\'s now');
    const logged = json(F.run(['log', '--tail', '5', '--json'], { DEVTEAM_ROLE: '' }).stdout);
    assert.ok(!logged.some((o) => /recover/i.test(JSON.stringify(o))), 'it logs nothing as anyone');
  } finally { server.done(); F.done(); }
});

test("the tick after an upgrade: a bare pane record whose agent runs as the supervisor is marked and kept up; one whose agent doesn't is no pane", { skip: !hasTmux }, async () => {
  const F = fixture('recupgrade', { resume: CLAUDE_RESUME });
  const run = path.join(F.root, 'docs/devteam/run');
  try {
    sessionTranscript(F);
    await seenUp(F);
    assert.equal(upRecord(F).up, true);
    // an older kit's record: the bare file only, and the supervisor hasn't run a command since the upgrade
    const bare = fs.readFileSync(path.join(run, 'supervisor-pane'), 'utf8').trim();
    write(path.join(run, 'supervisor-pane'), `${bare}\n`);
    fs.rmSync(path.join(run, 'supervisor-pane-role'));
    F.tick({ ...OFF, DEVTEAM_MACHINE_EPOCH: 'boot1' });
    assert.equal(fs.readFileSync(path.join(run, 'supervisor-pane-role'), 'utf8'), bare, "marked by the tick: the pane's agent is the supervisor's");
    assert.equal(fs.readFileSync(path.join(run, 'supervisor-pane'), 'utf8'), `${bare}\n`, 'the bare record as the older kit wrote it: only the mark is written');
    assert.equal(upRecord(F).up, true, 'still up, so a restart in this window brings it back');
    // an agent running as the supervisor but started in another directory, recorded bare: not this repo's
    F.agent('elsewhere', ['ELSEWHERE'], path.join(F.base, 'elsewhere'), { prefix: 'DEVTEAM_ROLE=supervisor ', shell: true });
    write(path.join(run, 'supervisor-pane'), `=${F.session}:elsewhere`);
    fs.rmSync(path.join(run, 'supervisor-pane-role'));
    await until(() => /ELSEWHERE/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', `=${F.session}:elsewhere`], { encoding: 'utf8' }).stdout), 'the agent in another directory');
    F.tick({ ...OFF, DEVTEAM_MACHINE_EPOCH: 'boot1' });
    assert.equal(fs.existsSync(path.join(run, 'supervisor-pane-role')), false, 'not marked: its pane started outside the repo');
    // an agent not running as the supervisor (the owner's own, say), recorded bare by an older kit
    F.agent('own-pane', ['OWN'], F.root, { prefix: '', shell: true });
    write(path.join(run, 'supervisor-pane'), `=${F.session}:own-pane`);
    await until(() => /OWN/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', `=${F.session}:own-pane`], { encoding: 'utf8' }).stdout), 'the agent at the root');
    F.tick({ ...OFF, DEVTEAM_MACHINE_EPOCH: 'boot1' });
    assert.equal(fs.existsSync(path.join(run, 'supervisor-pane-role')), false, 'not marked');
  } finally { F.done(); }
});

test('recover: a parked or drained fleet\'s supervisor comes back, pause or move', { skip: !hasTmux }, async () => {
  const F = fixture('recheld', { resume: CLAUDE_RESUME });
  const server = privateServer();
  try {
    sessionTranscript(F);
    await seenUp(F);
    F.killSession();
    // a supervisor is down only when someone exits it: a pause, a move or a drain brings it back
    for (const hold of [['park', '--reason', 'throttling spend'], ['park', '--move', '--reason', 'moving'], ['drain', '--move', '--reason', 'moving']]) {
      assert.equal(F.run(['fleet', ...hold]).status, 0);
      assert.match(recover(F, ['--dry-run'], server.env).stdout, new RegExp(`^would resume session ${SID}`), `fleet ${hold.join(' ')}: its supervisor comes back`);
      assert.equal(F.run(['fleet', hold[0] === 'park' ? 'unpark' : 'undrain']).status, 0);
    }
    assert.deepEqual(F.claudeCalls(), []);
    assert.match(recover(F, ['--force', '--dry-run'], server.env).stdout, new RegExp(`^would resume session ${SID}`), '--force: its supervisor decides');
  } finally { server.done(); F.done(); }
});

test('recover: one the owner stopped stays stopped, whether a tick saw it or not; --force starts it', { skip: !hasTmux }, async () => {
  const F = fixture('recstopped', { resume: CLAUDE_RESUME });
  const server = privateServer();
  try {
    sessionTranscript(F);
    await seenUp(F);
    // closed while the machine stayed up, and no tick since
    F.killSession();
    assert.match(recover(F, [], { DEVTEAM_MACHINE_EPOCH: 'boot1' }).stdout, /left stopped/, 'the same boot, the same tmux server: closed, not died');
    // closed in tmux and a tick saw it: it says stopped, and a later restart doesn't undo that
    F.ensureSession();
    write(upFile(F), JSON.stringify({ ...upRecord(F), up: true, machine: 'boot1', server: spawnSync('tmux', ['list-sessions', '-F', '#{pid}'], { encoding: 'utf8' }).stdout.trim().split('\n')[0] }));
    F.tick({ ...OFF, DEVTEAM_MACHINE_EPOCH: 'boot1' });
    assert.equal(upRecord(F).up, false, 'the tick noticed');
    assert.match(recover(F, [], server.env).stdout, /left stopped \(stopped before the restart/);
    assert.deepEqual(F.claudeCalls(), []);
    assert.match(recover(F, ['--force', '--dry-run'], server.env).stdout, /^would resume/);
  } finally { server.done(); F.done(); }
});

test('recover: a live supervisor gets no second one, in tmux or in a terminal, even with --force', { skip: !hasTmux }, async () => {
  const F = fixture('reclive', { resume: CLAUDE_RESUME });
  const fgDir = fs.mkdtempSync(path.join(F.base, 'fg-'));
  let fg;
  try {
    sessionTranscript(F);
    await seenUp(F);
    assert.match(recover(F, ['--force']).stdout, /already running/);
    F.killSession();
    // A supervisor in a plain terminal is known by its own commands: the kit found the agent above it.
    write(path.join(fgDir, 'claude'), `require('child_process').spawnSync(process.execPath, [${JSON.stringify(path.join(F.root, 'docs/devteam/scripts/devteam.mjs'))}, 'knowledge', 'add', '--kind', 'fact', '--statement', 's'], { stdio: 'ignore' }); setInterval(() => {}, 1000);\n`);
    fs.rmSync(upFile(F), { force: true });
    fs.rmSync(path.join(F.root, 'docs/devteam/run/supervisor-up.checked'), { force: true });
    fg = spawn(process.execPath, [path.join(fgDir, 'claude'), SKIP.trim()], { cwd: F.root, env: { ...F.env(), DEVTEAM_SUPERVISOR_UP: '', TMUX: '', TMUX_PANE: '', DEVTEAM_MACHINE_EPOCH: 'boot1' }, stdio: 'ignore' });
    await until(() => fs.existsSync(upFile(F)) && upRecord(F).kind === 'foreground', 'its own command noted it');
    assert.equal(upRecord(F).pid, fg.pid);
    assert.equal(upRecord(F).skip, true, 'its flag, read from the process');
    assert.match(recover(F, ['--force']).stdout, /already running/, 'alive: no second one');
    assert.deepEqual(F.claudeCalls(), []);
    fg.kill('SIGKILL');
    await until(() => fg.exitCode !== null || fg.signalCode !== null, 'it stopped');
    await until(() => recover(F, ['--dry-run']).stdout.startsWith('would resume'), 'dead, on a new boot, it is due');
  } finally { fg?.kill('SIGKILL'); F.done(); }
});

test('recover --here: a supervisor from a plain terminal comes back in this one', { skip: !hasTmux }, () => {
  const F = fixture('rechere', { resume: CLAUDE_RESUME });
  const bin = fs.mkdtempSync(path.join(F.base, 'bin-'));
  const calls = path.join(F.base, 'here-calls');
  try {
    sessionTranscript(F);
    write(upFile(F), JSON.stringify({ at: new Date().toISOString(), up: true, kind: 'foreground', pid: null, start: null, machine: 'boot1', skip: false }));
    write(path.join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\n`);
    fs.chmodSync(path.join(bin, 'claude'), 0o755);
    const did = spawnSync(process.execPath, [path.join(F.root, 'docs/devteam/scripts/devteam.mjs'), 'recover', '--here'], { cwd: F.root, encoding: 'utf8', env: { ...F.env(asOwner), SHELL: '/bin/sh', PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    assert.equal(did.status, 0, did.stderr);
    assert.match(did.stdout, /in this terminal/);
    assert.match(fs.readFileSync(calls, 'utf8'), new RegExp(`^--settings \\S+supervisor-claude\\.json --resume ${SID} This machine restarted`), 'no permissions flag: it had none');
  } finally { F.done(); }
});

test('recover: the log is no evidence of being up, and the flag is dropped only for someone at a laptop with evidence', { skip: !hasTmux }, async () => {
  const F = fixture('recgrant', { resume: CLAUDE_RESUME });
  try {
    sessionTranscript(F);
    assert.match(recover(F).stdout, /left stopped \(not running before/, 'nothing recorded: stays stopped');
    F.logLine('supervisor', { type: 'act', class: 'supervisor-up', what: `the supervisor was up with ${SKIP.trim()}`, refs: [], reversible: true });
    F.logLine('supervisor', { type: 'observation', source: 'pane', kind: 'supervisor-up', subject: 'supervisor', detail: 'up', detector: 'pane', source_key: 'x' });
    assert.match(recover(F).stdout, /left stopped \(not running before/, 'the log is no evidence of being up');
    assert.equal(recover(F, ['--force', '--dry-run']).stdout, `would resume session ${SID}\n`, '--force: the owner\'s command as configured');
    // evidence that it ran without the flag: dropped at a laptop, and never for the box or --force
    write(upFile(F), JSON.stringify({ at: new Date().toISOString(), up: true, kind: 'tmux', pane: '%1', server: null, machine: 'boot1', skip: false }));
    assert.match(recover(F, ['--dry-run']).stdout, new RegExp(`^would resume session ${SID} \\(without ${SKIP.trim()}: it ran without it\\)`));
    for (const args of [['--force'], ['--was-up'], ['--session', 'home', '--was-up']]) assert.equal(recover(F, [...args, '--dry-run']).stdout, `would resume session ${SID}\n`, args.join(' '));
    assert.notEqual(F.run(['recover'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-1' }).status, 0, 'a worker can\'t');
  } finally { F.done(); }
});

test('recover: a stale record stays stopped, a record from the future does too, and nothing wedges', { skip: !hasTmux }, () => {
  const F = fixture('recstale', { resume: CLAUDE_RESUME });
  try {
    sessionTranscript(F);
    const rec = { up: true, kind: 'tmux', pane: '%1', server: null, machine: 'boot1', skip: true };
    write(upFile(F), JSON.stringify({ ...rec, at: new Date(Date.now() - 4 * 86400000).toISOString() }));
    assert.match(recover(F).stdout, /left stopped \(last seen up 4 days ago/);
    write(upFile(F), JSON.stringify({ ...rec, at: new Date(Date.now() + 3600000).toISOString() }));
    assert.match(recover(F).stdout, /left stopped \(its record .* future/);
    // a recover that crashed mid-start: "starting" goes stale, and one dated in the future is ignored
    write(upFile(F), JSON.stringify({ ...rec, at: new Date().toISOString(), starting: Date.now() - 3600000 }));
    assert.match(recover(F, ['--dry-run']).stdout, /^would resume/);
    write(upFile(F), JSON.stringify({ ...rec, at: new Date().toISOString(), starting: Date.now() + 3600000 }));
    assert.match(recover(F, ['--dry-run']).stdout, /^would resume/);
    const lock = path.join(F.root, 'docs/devteam/run/recover.lock');
    fs.mkdirSync(lock, { recursive: true });
    const old = new Date(Date.now() - 3600000);
    fs.utimesSync(lock, old, old);
    assert.match(recover(F).stdout, /^resumed/, 'a lock left by a crash goes, and the restore goes ahead');
    assert.ok(!fs.existsSync(lock));
  } finally { spawnSync('tmux', ['kill-session', '-t', `=${F.session}`]); F.done(); }
});

test('recover: only the Claude Code harness resumes exactly, and the other says so', { skip: !hasTmux }, async () => {
  const F = fixture('reccodex', { resume: 'codex resume' });
  try {
    sessionTranscript(F);
    await seenUp(F);
    F.killSession();
    assert.match(recover(F, ['--dry-run']).stdout, /^would start fresh .*only Claude Code can resume a conversation exactly/);
  } finally { F.done(); }
});

test('recover --machine: every repo recorded on the machine, with each repo\'s own answer, a sibling skipped', { skip: !hasTmux }, async () => {
  const A = fixture('recmach-a', { resume: CLAUDE_RESUME });
  const B = fixture('recmach-b', { resume: CLAUDE_RESUME });
  const server = privateServer();
  try {
    sessionTranscript(A);
    await seenUp(A, { skip: true });
    A.killSession();
    B.tick({ ...OFF, DEVTEAM_MACHINE_EPOCH: 'boot1' });
    assert.equal(B.run(['fleet', 'park', '--move', '--reason', 'x']).status, 0);
    const reg = path.join(HOME, '.devteam', `repos-${process.env.DEVTEAM_HUB_PORT}`);
    fs.writeFileSync(path.join(reg, 'junk.json'), '{ not json');
    write(path.join(reg, 'gone.json'), JSON.stringify({ root: path.join(A.base, 'not-a-repo') }));
    const said = A.run(['recover', '--machine', '--dry-run'], { ...asOwner, ...server.env }).stdout;
    assert.match(said, new RegExp(`^recmach-a: would resume session ${SID}`, 'm'));
    assert.match(said, /^recmach-b: (would resume|would start fresh|left stopped \(not running before)/m, 'a parked fleet is no reason to leave it stopped');
    assert.match(said, /^not-a-repo: skipped/m);
    // a repo with the kit but no settings isn't adopted: refused on its own too, nothing started
    const kitOnly = path.join(A.base, 'kit-only');
    fs.mkdirSync(path.join(kitOnly, 'docs/devteam/scripts'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: kitOnly });
    fs.copyFileSync(path.join(A.root, 'docs/devteam/scripts/devteam.mjs'), path.join(kitOnly, 'docs/devteam/scripts/devteam.mjs'));
    const skipped = spawnSync(process.execPath, [path.join(kitOnly, 'docs/devteam/scripts/devteam.mjs'), 'recover'], { cwd: kitOnly, encoding: 'utf8', env: A.env(asOwner) });
    assert.notEqual(skipped.status, 0);
    assert.match(skipped.stderr, /no docs\/devteam\/project\/settings\.md here/);
    // two that aren't linked are both started; a home's sibling only with --force is skipped
    const sf = path.join(B.root, 'docs/devteam/project/settings.md');
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"project":', `"links": { "recmach-a": { "kind": "repo", "remote": ${JSON.stringify(A.root)}, "title": "a" } },\n  "project":`));
    const forced = A.run(['recover', '--machine', '--force', '--dry-run'], { ...asOwner, ...server.env }).stdout;
    assert.match(forced, /^recmach-a: skipped \(a sibling of recmach-b\)/m);
    assert.match(forced, /^recmach-b: would start fresh/m);
  } finally { server.done(); A.done(); B.done(); }
});

test('recover: two at once on one repo start one supervisor', { skip: !hasTmux }, async () => {
  const F = fixture('reccurrent', { resume: CLAUDE_RESUME });
  const server = privateServer();
  try {
    sessionTranscript(F);
    await seenUp(F);
    F.killSession();
    const dt = path.join(F.root, 'docs/devteam/scripts/devteam.mjs');
    const once = () => new Promise((resolve) => execFile(process.execPath, [dt, 'recover'], { cwd: F.root, env: F.env({ ...asOwner, ...server.env }), encoding: 'utf8' }, (err, stdout, stderr) => resolve({ status: err?.code ?? 0, stdout, stderr })));
    // fetch first, so with origin/main already current neither recover sets the ref and the start claim
    // alone is under test; two recovers meeting a moved origin's ref lock is kit-910's test below
    execFileSync('git', ['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main'], { cwd: F.root });
    const both = await Promise.all([once(), once()]);
    assert.deepEqual(both.map((r) => r.status), [0, 0], both.map((r) => `${r.stdout}${r.stderr}`.trim()).join(' | '));
    assert.equal(both.filter((r) => /^resumed session/.test(r.stdout)).length, 1, both.map((r) => r.stdout).join());
    assert.equal(both.filter((r) => /^already running/.test(r.stdout)).length, 1, both.map((r) => r.stdout).join());
    await until(() => F.claudeCalls().length === 1, 'the stand-in claude ran');
    sleepMs(300);
    assert.equal(F.claudeCalls().length, 1, 'one supervisor');
    const windows = spawnSync('tmux', ['list-windows', '-a', '-F', '#W'], { env: { ...process.env, TMUX_TMPDIR: server.dir }, encoding: 'utf8' }).stdout.trim().split('\n');
    assert.deepEqual(windows, ['supervisor']);
  } finally { server.done(); F.done(); }
});

// kit-910: once origin's main has moved since this checkout last read it, each recover's origin read
// sets origin/main here, and git holds that ref's lock while one does: the other read finds it held.
// origin read once, then a commit on main (the fixture's origin is the repo itself): origin moved
const moveOrigin = (F) => {
  execFileSync('git', ['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main'], { cwd: F.root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'origin moved'], { cwd: F.root });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: F.root, encoding: 'utf8' }).trim();
};
const trackingAt = (F) => execFileSync('git', ['rev-parse', 'refs/remotes/origin/main'], { cwd: F.root, encoding: 'utf8' }).trim();
// git's own trace (GIT_TRACE2_EVENT): how many update-refs ran and exited non-zero
const updatesRefused = (trace) => {
  const events = (fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '').split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const updates = new Set(events.filter((e) => e.event === 'start' && e.argv?.includes('update-ref')).map((e) => e.sid));
  return events.filter((e) => e.event === 'exit' && updates.has(e.sid) && e.code !== 0).length;
};

test('recover: two at once after origin moved both finish, though origin/main\'s lock is held as they set it (kit-910)', { skip: !hasTmux }, async () => {
  const F = fixture('reclockrace', { resume: CLAUDE_RESUME });
  const server = privateServer();
  const lock = path.join(F.root, '.git/refs/remotes/origin/main.lock');
  try {
    sessionTranscript(F);
    await seenUp(F);
    F.killSession();
    const main = moveOrigin(F);
    const traces = [path.join(F.base, 'git-trace-a.json'), path.join(F.base, 'git-trace-b.json')];
    const dt = path.join(F.root, 'docs/devteam/scripts/devteam.mjs');
    let ended = 0;
    const once = (trace) => new Promise((resolve) => execFile(process.execPath, [dt, 'recover'], { cwd: F.root, env: F.env({ ...asOwner, ...server.env, GIT_TRACE2_EVENT: trace }), encoding: 'utf8' }, (err, stdout, stderr) => { ended += 1; resolve({ status: err?.code ?? 0, stdout, stderr }); }));
    // The race made certain: the lock is held (as the other recover's update holds it) until git has
    // refused it to a read's update (each recover has its own trace), then until it has refused the other
    // too or 1 s has passed (well inside the 5 s a read waits on it, on any runner), or until a recover has
    // ended; git gives up on a held ref lock after 100 ms (core.filesRefLockTimeout), less than a loaded
    // box's other recover can hold it
    write(lock, '');
    const running = Promise.all(traces.map(once));
    await until(() => ended > 0 || traces.some((t) => updatesRefused(t) >= 1), 'git refused the held lock to a read, or a recover ended');
    const firstRefused = Date.now();
    await until(() => ended > 0 || traces.every((t) => updatesRefused(t) >= 1) || Date.now() - firstRefused >= 1000, 'the other read refused too, or 1 s passed');
    fs.rmSync(lock, { force: true });
    const both = await running;
    const said = both.map((r) => `${r.stdout}${r.stderr}`.trim()).join(' | ');
    assert.deepEqual(both.map((r) => r.status), [0, 0], said);
    assert.doesNotMatch(said, /could not read main from origin/, 'neither says origin did not answer');
    assert.equal(both.filter((r) => /^resumed session/.test(r.stdout)).length, 1, said);
    assert.equal(both.filter((r) => /^already running/.test(r.stdout)).length, 1, said);
    assert.equal(trackingAt(F), main, 'origin/main here is origin\'s');
    await until(() => F.claudeCalls().length === 1, 'the stand-in claude ran');
  } finally { fs.rmSync(lock, { force: true }); server.done(); F.done(); }
});

test('recover: origin that can\'t be reached is still said as one, and nothing starts (kit-910)', { skip: !hasTmux }, async () => {
  const F = fixture('recnoorigin', { resume: CLAUDE_RESUME });
  const server = privateServer();
  try {
    sessionTranscript(F);
    await seenUp(F);
    F.killSession();
    moveOrigin(F);
    execFileSync('git', ['remote', 'set-url', 'origin', path.join(F.base, 'no-such-origin')], { cwd: F.root });
    const r = recover(F, [], server.env);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    // git's own words on what it couldn't reach, as before kit-910
    assert.match(r.stderr, /could not read main from origin \('[^']*no-such-origin' does not appear to be a git repository\), so the owner's settings can't be confirmed and nothing was started/);
    assert.equal(F.claudeCalls().length, 0, 'nothing started');
  } finally { server.done(); F.done(); }
});

test('recover: a lock no one lets go on a moved origin/main still refuses, with git\'s words, inside the deadline (kit-910)', { skip: !hasTmux }, async () => {
  const F = fixture('recstalelock', { resume: CLAUDE_RESUME });
  const server = privateServer();
  const lock = path.join(F.root, '.git/refs/remotes/origin/main.lock');
  try {
    sessionTranscript(F);
    await seenUp(F);
    F.killSession();
    moveOrigin(F);
    const was = trackingAt(F);
    write(lock, '');
    const t0 = Date.now();
    const r = recover(F, [], server.env);
    const took = Date.now() - t0;
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /could not read main from origin \([^)]*(lock|Another git process)[^)]*\)/, 'git\'s own words on the lock');
    // the wait on a lock ends after 5 s, far inside the 30 s read (the rest is the read and the start)
    assert.ok(took < 20000, `gave up on the lock after about 5 s, not after ${took} ms`);
    assert.equal(trackingAt(F), was, 'origin/main here is as it was');
    assert.equal(F.claudeCalls().length, 0, 'nothing started');
    // a short deadline (a relaunch's, a restart's budget) ends the wait before it, still in git's words
    const short = recover(F, [], { ...server.env, DEVTEAM_LAUNCH_ORIGIN_MS: '5000' });
    assert.equal(short.status, 1, `${short.stdout}${short.stderr}`);
    assert.match(short.stderr, /could not read main from origin \([^)]*(lock|Another git process)[^)]*\)/, 'git\'s own words on the lock, before a short deadline');
  } finally { fs.rmSync(lock, { force: true }); server.done(); F.done(); }
});

// root writes where the mode says it can't, so there it is no other failure
test('recover: an origin/main here that git can\'t set for another reason refuses at once, tried once (kit-910)', { skip: !hasTmux || process.getuid?.() === 0 }, async () => {
  const F = fixture('recrefdenied', { resume: CLAUDE_RESUME });
  const server = privateServer();
  const refs = path.join(F.root, '.git/refs/remotes/origin');
  try {
    sessionTranscript(F);
    await seenUp(F);
    F.killSession();
    moveOrigin(F);
    const trace = path.join(F.base, 'git-trace.json');
    fs.chmodSync(refs, 0o555);
    const r = recover(F, [], { ...server.env, GIT_TRACE2_EVENT: trace });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /could not read main from origin \(update_ref failed for ref 'refs\/remotes\/origin\/main': cannot lock ref/, r.stderr);
    assert.equal(updatesRefused(trace), 1, 'git was asked once: only a held lock is waited on');
    assert.equal(F.claudeCalls().length, 0, 'nothing started');
  } finally { if (fs.existsSync(refs)) fs.chmodSync(refs, 0o755); server.done(); F.done(); }
});

test('recover: the start is claimed before a window opens, and taken back if nothing started', { skip: !hasTmux }, async () => {
  const F = fixture('recclaim', { resume: CLAUDE_RESUME });
  const server = privateServer();
  try {
    sessionTranscript(F);
    await seenUp(F);
    F.killSession();
    const before = upRecord(F);
    const seen = path.join(F.base, 'seen-at-open.json');
    const refuses = tmuxShim(F, `if [ "$1" = new-session ]; then cp ${JSON.stringify(upFile(F))} ${JSON.stringify(seen)}; exit 1; fi`);
    const failed = recover(F, [], { ...server.env, ...refuses });
    assert.equal(failed.status, 1, failed.stderr);
    assert.match(failed.stdout, /^NOT started \(tmux would not open its window\)/);
    assert.ok(json(fs.readFileSync(seen, 'utf8')).starting, 'claimed before the window was asked for');
    assert.deepEqual(upRecord(F), before, 'taken back: exactly the record it found');
    assert.match(recover(F, [], server.env).stdout, /^resumed session/, 'the next try doesn\'t wait it out');
  } finally { server.done(); F.done(); }
});

test('recover: a tick during a start does not read it as stopped, and one after the window does', { skip: !hasTmux }, async () => {
  const F = fixture('recticking', { resume: CLAUDE_RESUME });
  try {
    sessionTranscript(F);
    await seenUp(F);
    F.killSession();
    F.ensureSession();
    const server = spawnSync('tmux', ['list-sessions', '-F', '#{pid}'], { encoding: 'utf8' }).stdout.trim().split('\n')[0];
    const rec = { ...upRecord(F), server, machine: 'boot1', up: true };
    write(upFile(F), JSON.stringify({ ...rec, starting: Date.now() }));
    F.tick({ ...OFF, DEVTEAM_MACHINE_EPOCH: 'boot1' });
    assert.equal(upRecord(F).up, true, 'the agent has not exec\'d yet');
    write(upFile(F), JSON.stringify({ ...rec, starting: Date.now() - 3600000 }));
    F.tick({ ...OFF, DEVTEAM_MACHINE_EPOCH: 'boot1' });
    assert.equal(upRecord(F).up, false, 'long past the start: it stopped');
  } finally { F.done(); }
});

test('the supervisor\'s own command in a tmux pane counts only under an agent, never from a shell', { skip: !hasTmux }, async () => {
  const F = fixture('recself');
  try {
    F.ensureSession();
    const dt = path.join(F.root, 'docs/devteam/scripts/devteam.mjs');
    // In a script, not typed: the stub shell's PATH has no tmux, the kit has to ask tmux about its own
    // pane, and a real PATH typed at a shell runs past what a terminal takes in one line.
    const script = (name, body) => { const f = path.join(F.base, name); write(f, `#!/bin/sh\nexport PATH=${JSON.stringify(process.env.PATH)} DEVTEAM_ROLE=supervisor DEVTEAM_SUPERVISOR_UP= DEVTEAM_MACHINE_EPOCH=boot1\n${body}\n`); fs.chmodSync(f, 0o755); return f; };
    const checked = path.join(F.root, 'docs/devteam/run/supervisor-up.checked');
    const typed = (win, line) => { execFileSync('tmux', ['new-window', '-d', '-t', `=${F.session}:`, '-n', win, '-c', F.root]); execFileSync('tmux', ['send-keys', '-t', `=${F.session}:${win}`, '-l', line]); execFileSync('tmux', ['send-keys', '-t', `=${F.session}:${win}`, 'Enter']); };
    const done = path.join(F.base, 'shell-done');
    typed('from-shell', script('at-shell', `${process.execPath} ${dt} knowledge add --kind fact --statement s >/dev/null 2>&1; touch ${done}`));
    await until(() => fs.existsSync(done), 'the command ran at the shell');
    assert.ok(fs.existsSync(checked), 'it did look');
    assert.ok(!fs.existsSync(upFile(F)), 'and a shell is no supervisor: nothing recorded');
    fs.rmSync(checked);
    const agentDir = fs.mkdtempSync(path.join(F.base, 'agent-'));
    write(path.join(agentDir, 'claude'), `require('child_process').spawnSync(process.execPath, [${JSON.stringify(dt)}, 'knowledge', 'add', '--kind', 'fact', '--statement', 't'], { stdio: 'ignore' }); setInterval(() => {}, 1000);\n`);
    typed('from-agent', script('agent', `exec ${process.execPath} ${path.join(agentDir, 'claude')} ${SKIP.trim()}`));
    await until(() => fs.existsSync(upFile(F)), 'its own command noted it');
    assert.deepEqual([upRecord(F).up, upRecord(F).kind, upRecord(F).skip], [true, 'tmux', true]);
  } finally { F.done(); }
});

test('on Linux a boot is named by the kernel\'s boot id and init\'s start, so neither a reboot nor a redeploy is missed', { skip: !hasTmux || process.platform !== 'linux' }, async () => {
  const F = fixture('recboot', { resume: CLAUDE_RESUME });
  try {
    await seenUp(F, { skip: false });
    assert.match(upRecord(F).machine ?? '', /^boot1$/, 'the stand-in wins');
    F.tick(OFF);
    assert.match(upRecord(F).machine, /^[0-9a-f-]{36}:\d+$/);
  } finally { F.done(); }
});
