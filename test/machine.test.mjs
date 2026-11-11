// The machine's commands (machine status|tell|alert|pane-state) and recover --machine as a box runs
// it (cloud/Dockerfile's box-recover): every project on the machine, real tmux on this file's own
// server, stand-in agents, and repos on kits from before recover, taken from the release tags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasTmux, kit, testDir, until, write } from './lib/kit.mjs';

// tmux reads UTF-8 from the locale's name: the prompt's ❯ and its non-breaking space must survive
process.env.LANG = process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8';
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_CONFIG_DIR|DEVTEAM_ROLE|DEVTEAM_TICKET|DEVTEAM_FEATURE)$/.test(k)) delete process.env[k];
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
for (const k of ['DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete baseEnv[k];
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
  const reads = [['status'], ['status', '--json'], ['ready'], ['ready', '--json'], ['metrics'], ['metrics', '--json'], ['hello', '--json'], ['settings'], ['supervisor-session'], ['prompt', 'supervisor'], ['validate'], ['questions'], ['questions', '--json', '--all'], ['log', '--json', '--tail', '5'], ['messages', '--to', 'supervisor', '--open'], ['knowledge', '--json'], ['knowledge', '--for', 'x'], ['goal', '--json'], ['goal', 'list'], ['goal', 'show', goal], ['fleet', 'status', '--json', '--no-fetch'], ['trust'], ['trust', '--json'], ['problem'], ['problem', '--json', '--all'], ['sensor', 'status'], ['sensor', 'status', '--json'], ['sensor', 'series', 'web', '--range', '7d'], ['knowledge', '--kit'], ['machine', 'pane-state', '%7'], ['peek', 'lesson', k, '--json'], ['peek', 'lesson', k, '--mermaid'], ['peek', 'problem', p, '--json'], ['peek', 'goal', goal, '--json'], ['peek', 'sensor', 'web', '--json']];
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
