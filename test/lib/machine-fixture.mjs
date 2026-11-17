// What machine.*.test.mjs share: the machine's commands (machine status|tell|alert|pane-state) and
// recover --machine as a box runs it (cloud/Dockerfile's box-recover), every project on the machine,
// real tmux on this file's own server, stand-in agents, and repos on kits from before recover, taken
// from the release tags. Each part imports it, so each part (its own process) gets its own copy.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasTmux, kit, testDir, until, write } from './kit.mjs';

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

export { agent, baseEnv, box, code, conversation, dtIn, home, KIT, kitAt, latestRelease, link, machine, nowhere, prompt, repo, REPO, rule, shown, SID, tmp, tmuxSh };
