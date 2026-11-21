// What machine.*.test.mjs share: the machine's commands (machine status|tell|alert|pane-state) and
// recover --machine as a box runs it (cloud/Dockerfile's box-recover), every project on the machine,
// real tmux on this file's own server, stand-in agents, and repos on kits from before recover, taken
// from the release tags; below them, box-pins' changed-repo and --smoke helpers (machine.box-pins*)
// and statusFixture(), the check-in test's setup (machine.status*). Each part imports it, so each
// part (its own process) gets its own copy.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
// no tags, so the one needed is fetched from origin into a private repo of its own under tmp, never
// into the checkout's .git: two fetches into one shallow clone at once fail on its shallow file
// (kit-220, kit-760). A checkout that can't get it skips, never in CI. from: the checkout (a test's own).
const kits = new Map();
function kitAt(tag, { from = REPO } = {}) {
  const key = `${from}\0${tag}`;
  if (kits.has(key)) return kits.get(key);
  const has = (cwd) => spawnSync('git', ['rev-parse', '--verify', '-q', `${tag}^{commit}`], { cwd }).status === 0;
  let src = has(from) ? from : null;
  if (!src) {
    const url = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: from, encoding: 'utf8' }).stdout?.trim();
    const own = fs.mkdtempSync(path.join(tmp, 'tag-'));
    if (url && spawnSync('git', ['init', '-q', own], { stdio: 'ignore' }).status === 0) {
      spawnSync('git', ['fetch', '-q', '--depth=1', '--no-tags', url, `refs/tags/${tag}:refs/tags/${tag}`], { cwd: own, stdio: 'ignore', timeout: 60000 });
      if (has(own)) src = own;
    }
  }
  if (!src) { kits.set(key, null); return null; }
  const dir = fs.mkdtempSync(path.join(tmp, `kit-${tag}-`));
  execFileSync('tar', ['-x', '-C', dir], { input: execFileSync('git', ['archive', '--format=tar', tag, 'docs/devteam'], { cwd: src, maxBuffer: 64 * 1024 * 1024 }) });
  kits.set(key, path.join(dir, 'docs', 'devteam'));
  return kits.get(key);
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

// ---- from machine.box-pins.test.mjs ----
const PINS_CLEARED = ['DEVTEAM_IMAGE_HUB', 'DEVTEAM_KIT_RELEASE', 'DEVTEAM_BOX_TOOLS', 'DEVTEAM_PINS_NPM', 'DEVTEAM_PINS_PYPI', 'DEVTEAM_PINS_GITHUB', 'DEVTEAM_BOX_BIN', 'GH_TOKEN', 'GITHUB_TOKEN', 'UV_TOOL_DIR'];
const pinsEnv = (extra = {}) => { const e = { ...baseEnv }; for (const k of PINS_CLEARED) delete e[k]; return { ...e, ...extra }; };
function fakeBins(name, scripts) {
  const d = path.join(tmp, name);
  for (const [f, body] of Object.entries(scripts)) { write(path.join(d, f), `#!/bin/sh\n${body}\n`); fs.chmodSync(path.join(d, f), 0o755); }
  return d;
}

// ===== box-pins changed: what a release range changes in what the box image runs (image-changes@1) =====
// A kit repo made from this checkout's tracked tree (the working tree's copy, so the change under
// test is in it), tagged v9.1.0; each case is a branch off the tag with one commit, run with that
// branch's own script, as a release script or the deploy gate runs it from a checkout at --to.
const SCRIPT = 'docs/devteam/scripts/devteam.mjs';
const GIT_ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const changedRepo = path.join(tmp, 'changed-kit');
const cg = (args) => execFileSync('git', args, { cwd: changedRepo, encoding: 'utf8', env: { ...pinsEnv(), ...GIT_ID } });
let changedBuilt = false;
function changedKit() {
  if (changedBuilt) return changedRepo;
  fs.mkdirSync(changedRepo);
  cg(['init', '-q', '-b', 'main']);
  cg(['remote', 'add', 'origin', 'git@github.com:sanctuarycomputer/devteam.git']);
  for (const f of execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean)) {
    const from = path.join(REPO, f), to = path.join(changedRepo, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const st = fs.lstatSync(from, { throwIfNoEntry: false });
    if (!st) continue; // deleted in the working tree, not yet committed
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else fs.copyFileSync(from, to), fs.chmodSync(to, st.mode & 0o777);
  }
  cg(['add', '-A']);
  cg(['commit', '-qm', 'v9.1.0']);
  cg(['tag', 'v9.1.0']);
  changedBuilt = true;
  return changedRepo;
}
// edits: { path: (text) => text | null (delete) }, or a function given the repo for anything else
function onBranch(name, edits, from = 'v9.1.0') {
  changedKit();
  cg(['checkout', '-q', '-B', name, from]);
  if (typeof edits === 'function') edits(changedRepo);
  else for (const [f, fn] of Object.entries(edits)) {
    const p = path.join(changedRepo, f);
    const t = fn(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
    if (t === null) fs.rmSync(p); else write(p, t);
  }
  cg(['add', '-A']);
  cg(['commit', '-qm', name]);
  return cg(['rev-parse', 'HEAD']).trim();
}
// one edit to the script: text after an anchor that must occur exactly once
const after = (anchor, add) => (t) => { assert.equal(t.split(anchor).length, 2, `anchor ${anchor} once`); return t.replace(anchor, () => `${anchor}${add}`); };
const changed = (args, env = {}) => spawnSync(process.execPath, [path.join(changedRepo, SCRIPT), 'box-pins', 'changed', ...args], { cwd: changedRepo, encoding: 'utf8', env: pinsEnv(env), timeout: 600000 });
let smokeRuns = 0;
// the next trace number, for a test that names its own trace (an importer can't bump smokeRuns itself)
const nextSmokeRun = () => ++smokeRuns;
function smokeRun(args, extra = {}) {
  const tmpd = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'smoke-tmp-')));
  const trace = path.join(tmp, `smoke-trace-${++smokeRuns}.jsonl`);
  const r = changed([...args, '--smoke'], { TMPDIR: tmpd, DEVTEAM_SMOKE_TRACE: trace, ...extra });
  const lines = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { r, tmpd, trace: lines };
}
const testHome = pinsEnv().HOME;
const lsOr = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
function leftNothing(tmpd) {
  assert.deepEqual(fs.readdirSync(tmpd), [], 'the temporary folder, its worktree and tmux folder are gone');
  assert.deepEqual(lsOr(path.join(changedRepo, '.git', 'worktrees')), [], 'git\'s record of the smoke worktree is removed');
  assert.equal(cg(['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree ')).length, 1);
  assert.equal(cg(['status', '--porcelain']), '', 'nothing written in the checkout');
  const dot = lsOr(path.join(testHome, '.devteam'));
  assert.deepEqual(dot.filter((n) => n.startsWith('repos-') || n.startsWith('status-last-')), [], 'nothing under the test HOME\'s ~/.devteam');
}

// "status says at a glance what a check-in needs, and reads no pane it needn't" (machine.status*.test.mjs), in parts (kit-221): its setup, the
// original L41-L82, run once by each part. The project folder is a fresh one, so two parts in one
// process never share one. status() keeps each reading's stdout, for readNothing(): what no reading
// may do, checked at the end of every part over its own readings. done() is the original's finally.
async function statusFixture() {
  const notes = path.join(home, 'operator/NOTES.md');
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.rmSync(path.join(home, '.box/alert'), { force: true });
  const last = path.join(home, '.devteam', `status-last-${process.env.DEVTEAM_HUB_PORT}`);
  fs.rmSync(last, { force: true });
  const sub = fs.mkdtempSync(path.join(tmp, 'status-code-'));
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
  fs.writeFileSync(path.join(r, 'docs/devteam/run/accounts.json'), JSON.stringify({ at: new Date().toISOString(), cswap: true, active: 'a@b', active_no_room: false, exhausted: false, needs_login: ['c@d'], restart_gave_up: [], supervisor_limit: null, capacity: { accounts: 5, room: 1, unknown: 0, active_week_pct: 9, active_5h_pct: 31, runs_out_at: null, next_reset_at: '2026-11-16T21:00:00Z', gap: false } }));
  // tmux, as the kit sees it, noting what it was asked
  const logged = path.join(tmp, 'tmux-asked');
  const spy = path.join(tmp, 'spy');
  write(path.join(spy, 'tmux'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(logged)}\nPATH=${JSON.stringify(process.env.PATH)} exec tmux "$@"\n`);
  fs.chmodSync(path.join(spy, 'tmux'), 0o755);
  const srv = spawn(process.execPath, ['-e', "require('http').createServer((q, r) => r.end('ok')).listen(0, '127.0.0.1', function () { console.log(this.address().port); });"], { stdio: ['ignore', 'pipe', 'inherit'] });
  const portUp = await new Promise((ok) => srv.stdout.once('data', (d) => ok(Number(String(d).trim()))));
  const worker = path.join(tmp, 'statused-wt');
  fs.mkdirSync(worker, { recursive: true });
  const a = agent({ screens: [box(prompt), `✻ Ticking… (esc to interrupt)\n${box(prompt)}`], cwd: r, window: 'sup-statused' });
  const shell = agent({ screens: ['secret in the owner\'s shell'], cwd: home, window: 'shell' });
  const x = agent({ screens: [`line\n${box(prompt)}`, `other output now\n${box(prompt)}`], cwd: worker, window: 'worker-x' });
  const y = agent({ screens: [`You've hit your limit · resets 3pm\n${box(prompt)}`], cwd: worker, window: 'worker-y' });
  const status = (args = [], env = {}) => machine(['machine', 'status', '--in', sub, '--notes', notes, ...args], { PATH: `${spy}${path.delimiter}${baseEnv.PATH}`, ...env });
  const outs = [];
  const read = (...args) => { const o = status(...args); outs.push(o.stdout); return o; };
  const readNothing = () => {
    for (const out of outs) assert.doesNotMatch(out, new RegExp(`${shell.pane}\\b`), 'never the owner\'s shell');
    assert.doesNotMatch(fs.readFileSync(logged, 'utf8'), new RegExp(`capture-pane .*-t ${shell.pane}$`, 'm'), 'not even read');
    assert.ok(!fs.existsSync(path.join(r, 'docs/devteam/run/supervisor-pane')), 'reading a project writes nothing of its');
  };
  const done = () => {
    srv.kill();
    for (const p of [a, shell, x, y]) p.kill();
    fs.writeFileSync(latestRelease, 'v9.9.9\n');
  };
  try {
    for (const p of [a, x, y]) await shown(p.pane, 'status');
    fs.writeFileSync(path.join(r, 'docs/devteam/run/dashboard-port'), `${portUp}\n`);
    fs.writeFileSync(logged, '');
  } catch (e) {
    done();
    throw e;
  }
  return { a, done, kitL, last, logged, notes, portUp, r, readNothing, rule, shell, status: read, sup, x, y };
}

export { after, agent, baseEnv, box, cg, changed, changedKit, changedRepo, code, conversation, dtIn, fakeBins, home, KIT, kitAt, latestRelease, leftNothing, link, lsOr, machine, nextSmokeRun, nowhere, onBranch, pinsEnv, prompt, repo, REPO, rule, SCRIPT, shown, SID, smokeRun, statusFixture, testHome, tmp, tmuxSh };
