// cloud/box-supervisors: which supervisors a box brings back, and which it leaves alone; and that
// the kit lets a box's operator look but not act. A shim stands in for tmux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const kit = path.resolve(here, '..', 'docs', 'devteam');
const script = path.resolve(here, '..', 'cloud', 'box-supervisors');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-box-')));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const home = path.join(tmp, 'home');
const code = path.join(home, 'code');
fs.mkdirSync(code, { recursive: true });
const dtIn = (r, args, env = {}) => spawnSync(process.execPath, [path.join(r, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: r, encoding: 'utf8', env: { ...baseEnv, ...env } });

// tmux that knows no panes unless told, logs what it's asked, and answers a new window with %9
const shim = path.join(tmp, 'bin');
fs.mkdirSync(shim);
const tmuxLog = path.join(tmp, 'tmux.log');
const panesFile = path.join(tmp, 'panes');
// a pane's screen, as capture-pane would give it: <screens>/<pane id>
const screens = path.join(tmp, 'screens');
fs.mkdirSync(screens);
fs.writeFileSync(path.join(shim, 'tmux'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${tmuxLog}'\ncase "$1" in\n  list-panes) cat '${panesFile}' 2>/dev/null ;;\n  new-window) echo '%9' ;;\n  capture-pane) for a; do t=$a; done; cat "${screens}/$t" 2>/dev/null ;;\nesac\nexit 0\n`, { mode: 0o755 });
// gh that knows one release, and nothing else
const latestRelease = path.join(tmp, 'latest');
fs.writeFileSync(path.join(shim, 'gh'), `#!/bin/sh\n[ "$1" = release ] && cat '${latestRelease}' 2>/dev/null\nexit 0\n`, { mode: 0o755 });
fs.writeFileSync(latestRelease, 'v9.9.9\n');
const baseEnv = { ...process.env, HOME: home, PATH: `${shim}${path.delimiter}${process.env.PATH}`, DEVTEAM_NODE: process.execPath, DEVTEAM_HUB_PORT: '9' };
for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE', 'CLAUDE_CONFIG_DIR']) delete baseEnv[k];

function repo(name, { links, settings, adopt = true } = {}) {
  const r = path.join(code, name);
  fs.mkdirSync(r);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: r });
  execFileSync('git', ['remote', 'add', 'origin', `git@github.com:Acme/${name}.git`], { cwd: r });
  fs.cpSync(kit, path.join(r, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  if (!adopt) return r;
  const i = dtIn(r, ['init', '--name', name]);
  assert.equal(i.status, 0, i.stderr);
  if (links || settings) {
    const f = path.join(r, 'docs/devteam/project/settings.md');
    const s = fs.readFileSync(f, 'utf8');
    const m = /```json devteam\s*\n([\s\S]*?)\n```/.exec(s);
    const j = { ...JSON.parse(m[1]), ...settings, ...(links ? { links } : {}) };
    fs.writeFileSync(f, s.replace(m[1], JSON.stringify(j, null, 2)));
  }
  execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init'], { cwd: r });
  return r;
}
const link = (name) => ({ kind: 'repo', remote: `https://github.com/acme/${name}`, title: name });
const run = (args = [], env = {}) => spawnSync('sh', [script, ...args], { encoding: 'utf8', env: { ...baseEnv, ...env } });
const lines = (r) => Object.fromEntries(r.stdout.trim().split('\n').filter(Boolean).map((l) => { const i = l.indexOf(': '); return [l.slice(0, i), l.slice(i + 2)]; }));
const boot = path.join(home, '.devteam-supervisors.boot');
const session = (r) => { const d = path.join(home, '.claude/projects', r.replace(/[^a-zA-Z0-9]/g, '-')); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '11111111-2222-3333-4444-555555555555.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'You are the supervisor for this repository' } })}\n`); };

test('which supervisors come back, and which are left alone', () => {
  const sib = repo('a-sibling');
  const h = repo('home-repo', { links: { 'a-sibling': link('a-sibling') }, settings: { worktree_files: ['config/master.key'] } });
  repo('mutual-a', { links: { 'mutual-b': link('mutual-b') } });
  repo('mutual-b', { links: { 'mutual-a': link('mutual-a') } });
  repo('lone');
  const parked = repo('parked');
  const pk = dtIn(parked, ['fleet', 'park', '--reason', 'moving'], { DEVTEAM_ROLE: 'supervisor' });
  assert.equal(pk.status, 0, pk.stderr + pk.stdout);
  repo('kit-only', { adopt: false });
  session(h);
  fs.writeFileSync(boot, `${sib}\n${h}\n${parked}\n`);

  const dflt = lines(run(['--dry-run']));
  assert.match(dflt['a-sibling'], /^would start fresh/, 'a repo that ran a supervisor comes back, even if another links to it');
  assert.match(dflt['home-repo'], /^would resume session 11111111-.* \(missing here: config\/master\.key/);
  assert.match(dflt.parked, /left stopped \(its fleet is held: park\)/);
  assert.match(dflt.lone, /left stopped \(not running before/);
  assert.equal(dflt['kit-only'], undefined, 'the kit without settings is not adopted');

  const all = lines(run(['--all', '--dry-run']));
  assert.match(all['a-sibling'], /skipped \(a sibling of home-repo\)/, 'a sibling is found whichever sorts first');
  assert.match(all['mutual-a'], /^would start fresh/, 'two that link each other are both homes');
  assert.match(all['mutual-b'], /^would start fresh/);
  assert.match(all.lone, /^would start fresh/);
  assert.match(all.parked, /^would start fresh/, '--all starts a parked repo: its supervisor decides');
  assert.ok(fs.existsSync(boot), 'a dry run changes nothing');

  // already up: a pane at the repo's root, or the pane it noted; never a second one
  fs.writeFileSync(panesFile, `%1\tmine\t${h}\tclaude\n%2\tdash-lone\t${path.join(code, 'lone')}\tnode\n%3\tdashboard\t${path.join(code, 'parked')}\tnode\n`);
  const up = lines(run(['--all', '--dry-run']));
  assert.match(up['home-repo'], /already running/);
  assert.match(up.lone, /^would start fresh/, 'a dashboard is not a supervisor');
  assert.match(up.parked, /^would start fresh/, 'nor is one in its own session, where the kit keeps it');
  fs.rmSync(panesFile);

  // a real restore: the window, the noted pane, the first message, the list used up
  fs.writeFileSync(tmuxLog, '');
  const real = lines(run());
  assert.match(real['home-repo'], /^resumed session 11111111-.*asked to get: config\/master\.key/);
  assert.equal(fs.readFileSync(path.join(h, 'docs/devteam/run/supervisor-pane'), 'utf8'), '%9');
  assert.doesNotMatch(fs.readFileSync(path.join(h, 'docs/devteam/run/supervisor-prompt.txt'), 'utf8'), /Every worker and planner window is gone/, 'the tick relaunches them');
  assert.match(fs.readFileSync(path.join(h, 'docs/devteam/run/supervisor-prompt.txt'), 'utf8'), /missing: config\/master\.key.*\n?.*Inbox.*--secrets.*file:<path>/s);
  const typed = fs.readFileSync(tmuxLog, 'utf8');
  assert.match(typed, /new-window -dP -F #\{pane_id\} -t home -n sup-home-repo/);
  assert.match(typed, /export DEVTEAM_ROLE=supervisor; claude --resume 11111111-2222-3333-4444-555555555555 --dangerously-skip-permissions "\$\(cat '.*supervisor-prompt\.txt'\)"/);
  assert.ok(!fs.existsSync(boot), 'the list is used up once they are back');

  const st = run(['--status']);
  assert.equal(st.status, 0, st.stderr);
  assert.match(st.stdout, /^box: disk /m);
  assert.match(st.stdout, /^home-repo sup=down fleet=\S+ kit=\S+ inbox=\S+ missing=config\/master\.key/m);
  assert.match(st.stdout, /^a-sibling .*sibling-of=home-repo$/m);
});

test('--all <repo> starts that one repo, and leaves every other fleet as it is', () => {
  const dotted = repo('my.dotted');
  const parked = repo('all-one-parked');
  assert.equal(dtIn(parked, ['fleet', 'park', '--reason', 'x'], { DEVTEAM_ROLE: 'supervisor' }).status, 0);
  repo('bystander');
  fs.writeFileSync(panesFile, '');
  const one = run(['--all', 'all-one-parked', '--dry-run']);
  assert.equal(one.status, 0, one.stderr);
  const said = lines(one);
  assert.match(said['all-one-parked'], /^would start fresh/, 'a held fleet it was asked for comes up: its supervisor decides');
  assert.equal(said.bystander, undefined);
  assert.equal(said['my.dotted'], undefined);
  fs.writeFileSync(tmuxLog, '');
  const started = lines(run(['--all', 'my.dotted']));
  assert.match(started['my.dotted'], /^started fresh/);
  assert.equal(fs.readFileSync(path.join(dotted, 'docs/devteam/run/supervisor-pane'), 'utf8'), '%9');
  const typed = fs.readFileSync(tmuxLog, 'utf8');
  assert.match(typed, /send-keys -t %9 -l/, 'typed by pane id: a dot in a window name reads as a pane to tmux');
  assert.ok(!typed.includes('all-one-parked'));
  const bad = run(['--all', 'no-such']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /no adopted repo "no-such"/);
});

const screen = (id, text) => fs.writeFileSync(path.join(screens, id), text);
const rule = '\x1b[38;5;244m' + '─'.repeat(60) + '\x1b[39m';
const box = (line) => `the agent's last output\n${rule}\n${line}\n${rule}\n\x1b[38;5;211mstatus\x1b[39m\n`;
const state = (p, cmd, text) => { fs.writeFileSync(panesFile, `${p}\tw\t/nowhere\t${cmd}\thome\n`); if (text !== undefined) screen(p, text); return run(['--pane-state', p]).stdout.trim(); };

test('what a pane is at, from what is on it', () => {
  assert.equal(state('%20', 'claude', box('\x1b[38;5;246m❯ \x1b[39m')), 'ready', 'an empty input');
  assert.equal(state('%20', 'claude', box('\x1b[39m❯ \x1b[2mcopy the .env.local files\x1b[0m')), 'ready', 'a dim suggestion is the harness\'s, not typing');
  assert.equal(state('%20', 'claude', box('❯ fix the ')), 'typing', 'text in the input box is someone\'s');
  assert.equal(state('%20', 'claude', box('❯ fix the \x1b[2mbug\x1b[0m')), 'typing', 'typed text with a suggestion after it is still typing');
  assert.equal(state('%20', 'claude', `Do you trust the files in this folder?\n❯ 1. Yes, I trust\n`), 'dialog');
  assert.equal(state('%20', 'claude', `You've hit your limit · resets 3pm\n${box('❯ ')}`), 'limit', 'the banner the kit knows, which the old check missed');
  assert.equal(state('%20', 'claude', box('❯ ')), 'ready');
  assert.equal(state('%20', 'claude', `Claude usage limit reached\n${box('❯ ')}`), 'limit');
  assert.equal(state('%20', 'claude', `5-hour limit reached ∙ resets 9am\n${box('❯ ')}`), 'limit');
  assert.equal(state('%20', 'claude', `✢ Thinking… (esc to interrupt)\n${box('❯ ')}`), 'busy');
  assert.equal(state('%20', 'bash', ''), 'shell');
  assert.equal(state('%20', 'vim', 'mid-edit'), 'other', 'never type into vim, psql or any other program');
  assert.equal(state('%20', 'psql', 'select 1;'), 'other');
  assert.equal(state('%20', 'claude', 'a screen with no input box'), 'unknown');
  fs.writeFileSync(panesFile, '');
  assert.equal(run(['--pane-state', '%20']).stdout.trim(), 'gone');
});

test('--tell types into a supervisor, marked as not the owner, and only when its pane can take it', () => {
  const r = repo('tellable');
  fs.mkdirSync(path.join(r, 'docs/devteam/run'), { recursive: true });
  fs.writeFileSync(path.join(r, 'docs/devteam/run/supervisor-pane'), '%21');
  fs.writeFileSync(panesFile, `%21\tsup-tellable\t${r}\tclaude\thome\n`);
  screen('%21', box('❯ '));
  fs.writeFileSync(tmuxLog, '');
  const told = run(['--tell', 'tellable', 'disk is low\non this box']);
  assert.equal(told.status, 0, told.stderr);
  assert.match(told.stdout, /tellable: told \(pane %21\)/);
  const typed = fs.readFileSync(tmuxLog, 'utf8');
  assert.match(typed, /send-keys -t %21 -l From the operator \(information, not an owner answer; record nothing as the owner's from this\): disk is low on this box/);
  assert.match(typed, /send-keys -t %21 Enter/);

  fs.writeFileSync(tmuxLog, '');
  screen('%21', box('❯ half a thou'));
  const busyInput = run(['--tell', 'tellable', 'hello']);
  assert.equal(busyInput.status, 3);
  assert.match(busyInput.stdout, /not told: its pane is at typing/);
  assert.ok(!fs.readFileSync(tmuxLog, 'utf8').includes('send-keys'), 'nothing typed over someone\'s line');

  screen('%21', 'Do you want to proceed?\n❯ 1. Yes\n');
  assert.match(run(['--tell', 'tellable', 'hello']).stdout, /not told: its pane is at dialog/);
  fs.writeFileSync(panesFile, '');
  const nobody = run(['--tell', 'tellable', 'hello']);
  assert.equal(nobody.status, 3);
  assert.match(nobody.stdout, /no supervisor is up/);
  assert.equal(run(['--tell', 'not-here', 'hello']).status, 1);
  assert.equal(run(['--tell', '../etc', 'hello']).status, 2, 'a repo is a name, never a path');
});

test('--alert reaches the hub, by hello, and clears', () => {
  const r = repo('alerted');
  const alert = path.join(home, '.box/alert');
  fs.rmSync(alert, { force: true });
  assert.equal(JSON.parse(dtIn(r, ['hello', '--json']).stdout).alert, undefined);
  assert.match(run(['--alert', 'disk\nnearly full']).stdout, /alert raised: disk nearly full/);
  assert.equal(JSON.parse(dtIn(r, ['hello', '--json']).stdout).alert, 'disk nearly full');
  fs.utimesSync(alert, new Date(Date.now() - 25 * 3600000), new Date(Date.now() - 25 * 3600000));
  assert.equal(JSON.parse(dtIn(r, ['hello', '--json']).stdout).alert, undefined, 'a day old, it has been seen or forgotten');
  run(['--alert', 'again']);
  assert.match(run(['--alert', '--clear']).stdout, /alert cleared/);
  assert.ok(!fs.existsSync(alert));
  assert.equal(run(['--alert']).status, 2);
});

test('--status says at a glance what a check-in needs', async () => {
  const notes = path.join(home, 'operator/NOTES.md');
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.rmSync(path.join(home, '.box/alert'), { force: true });
  fs.rmSync(path.join(home, '.box/status-last'), { force: true });
  const r = repo('statused', { settings: { upstream_base: 'v0.1.0' } });
  // a question, one of them already noted
  const q1 = dtIn(r, ['ask', '--question', 'first?', '--kind', 'owner-decision', '--class', 'design', '--reasons', 'x'], { DEVTEAM_ROLE: 'supervisor' });
  assert.equal(q1.status, 0, q1.stderr + q1.stdout);
  const q2 = dtIn(r, ['ask', '--question', 'second?', '--kind', 'owner-decision', '--class', 'design', '--reasons', 'x'], { DEVTEAM_ROLE: 'supervisor' });
  assert.equal(q2.status, 0, q2.stderr + q2.stdout);
  fs.writeFileSync(notes, `read ${q1.stdout.trim()}\n`);
  fs.mkdirSync(path.join(r, 'docs/devteam/run'), { recursive: true });
  fs.writeFileSync(path.join(r, 'docs/devteam/run/supervisor-pane'), '%30');
  fs.mkdirSync(path.join(r, '.worktrees/a/node_modules'), { recursive: true });
  fs.writeFileSync(path.join(r, '.worktrees/a/node_modules/big'), Buffer.alloc(4096 * 256));
  fs.writeFileSync(path.join(r, 'docs/devteam/run/accounts.json'), JSON.stringify({ at: new Date().toISOString(), cswap: true, active: 'a@b', active_no_room: false, exhausted: false, needs_login: ['c@d'], restart_gave_up: [], supervisor_limit: null }));
  // a real listener for the dashboard's port, one nothing answers for the other side of it
  const srv = spawn(process.execPath, ['-e', "require('http').createServer((q, r) => r.end('ok')).listen(0, '127.0.0.1', function () { console.log(this.address().port); });"], { stdio: ['ignore', 'pipe', 'inherit'] });
  const portUp = await new Promise((ok) => srv.stdout.once('data', (d) => ok(Number(String(d).trim()))));
  try {
    fs.writeFileSync(path.join(r, 'docs/devteam/run/dashboard-port'), `${portUp}\n`);
    const worker = path.join(code, 'statused-wt');
    fs.writeFileSync(panesFile, `%30\tsup-statused\t${r}\tclaude\thome\n%31\tshell\t${home}\tbash\thome\n%32\tworker-x\t${worker}\tclaude\tdevteam-statused\n%33\tworker-y\t${worker}\tclaude\tdevteam-statused\n`);
    screen('%30', box('❯ '));
    screen('%31', 'secret in the owner\'s shell');
    screen('%32', `line\n${box('❯ ')}`);
    screen('%33', `You've hit your limit · resets 3pm\n${box('❯ ')}`);
    fs.writeFileSync(latestRelease, 'v9.9.9\n');
    const st = run(['--status'], { DEVTEAM_STATUS_SECONDS: '0' });
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /^box: disk \S+ free of \S+/m);
    assert.match(st.stdout, /^box: accounts cswap active=a@b exhausted=false no-room=false needs-login=c@d as of /m);
    assert.match(st.stdout, /^box: hub 9 DOWN/m);
    assert.match(st.stdout, new RegExp(`^statused sup=up .*kit=v0\\.1\\.0\\S* .* behind=v9\\.9\\.9 pane=%30 state=ready dash=${portUp}/up wt=1/\\S+ new-questions=1`, 'm'));
    assert.match(st.stdout, /^attention: %33 devteam-statused:worker-y limit$/m);
    assert.doesNotMatch(st.stdout, /%31/, 'never the owner\'s shell');
    assert.ok(!fs.readFileSync(tmuxLog, 'utf8').includes('capture-pane -e -p -t %31') && !fs.readFileSync(tmuxLog, 'utf8').includes('capture-pane -p -t %31'), 'not even read');
    assert.match(st.stdout, /changed since last reading: %30 %32 %33/m, 'no reading before: everything changed');
    const q = run(['--status', '--questions']);
    assert.match(q.stdout, /^statused q-\S+ \[owner-decision\] second\?$/m);
    assert.doesNotMatch(q.stdout, /first\?/, 'noted in NOTES.md, so not read again');
    const fileAt = path.join(home, '.box/status-last');
    assert.match(fs.readFileSync(fileAt, 'utf8'), /^at \d+\ndisk \d+\npane %30 \d+\n/, 'the reading it keeps');
    screen('%32', `other output now\n${box('❯ ')}`);
    const st2 = run(['--status'], { DEVTEAM_STATUS_SECONDS: '0' });
    assert.match(st2.stdout, /changed since last reading: %32 *$/m, 'only what moved: a pane whose screen changed');
    // the reading is held 20 minutes, so a manual re-run doesn't erase the change the next check-in should see
    const stuck = fs.readFileSync(fileAt, 'utf8');
    run(['--status']);
    assert.equal(fs.readFileSync(fileAt, 'utf8'), stuck);
    // a dashboard's port nothing answers is down; a repo whose kit is at the latest isn't behind
    fs.writeFileSync(path.join(r, 'docs/devteam/run/dashboard-port'), '9\n');
    fs.writeFileSync(latestRelease, 'v0.1.0\n');
    const st3 = run(['--status']);
    assert.match(st3.stdout, /^statused .*dash=9\/DOWN/m);
    assert.doesNotMatch(st3.stdout, /behind=/);
    run(['--alert', 'look at the disk']);
    assert.match(run(['--status']).stdout, /^box: hub 9 DOWN; alert: look at the disk$/m);
    run(['--alert', '--clear']);
  } finally {
    srv.kill();
    fs.writeFileSync(panesFile, '');
    fs.writeFileSync(latestRelease, 'v9.9.9\n');
  }
});

// Every read the operator is allowed, against a repo with something in it: the log, git status and
// the files on disk are byte-for-byte what they were. That's the point of the list.
test('each read the operator may run writes nothing', () => {
  const r = repo('read-only', { settings: { upstream_base: 'v0.2.0' } });
  const sup = { DEVTEAM_ROLE: 'supervisor' };
  assert.equal(dtIn(r, ['goal', 'add', '--title', 'a goal', '--outcome', 'x'], sup).status, 0);
  const goal = dtIn(r, ['goal'], sup).stdout.match(/g-\S+/)?.[0];
  assert.ok(goal);
  assert.equal(dtIn(r, ['knowledge', 'add', '--kind', 'fact', '--statement', 's'], sup).status, 0);
  assert.equal(dtIn(r, ['ask', '--question', 'q?', '--kind', 'owner-decision', '--class', 'design', '--reasons', 'x'], sup).status, 0);
  assert.equal(dtIn(r, ['send', 'supervisor', 'hello'], sup).status, 0);
  // a transcript, so metrics has something to parse and cache
  session(r);
  const op = { DEVTEAM_ROLE: 'operator', TMUX: 'x', TMUX_PANE: '%7' };
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.name === '.git') continue; if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };
  const snap = () => ({ files: Object.fromEntries(walk(r).map((f) => [f, fs.readFileSync(f).toString('base64')])), status: execFileSync('git', ['status', '--porcelain'], { cwd: r, encoding: 'utf8' }) });
  const before = snap();
  const reads = [['status'], ['status', '--json'], ['ready'], ['ready', '--json'], ['metrics'], ['metrics', '--json'], ['hello', '--json'], ['settings'], ['supervisor-session'], ['validate'], ['questions'], ['questions', '--json', '--all'], ['log', '--json', '--tail', '5'], ['messages', '--to', 'supervisor', '--open'], ['knowledge', '--json'], ['knowledge', '--for', 'x'], ['goal', '--json'], ['goal', 'list'], ['goal', 'show', goal], ['fleet', 'status', '--json', '--no-fetch']];
  for (const c of reads) { const x = dtIn(r, c, op); assert.ok(x.status === 0 || x.status === 1, `${c.join(' ')}: ${x.stderr}`); assert.doesNotMatch(x.stderr, /only reads/, c.join(' ')); }
  const after = snap();
  assert.deepEqual(Object.keys(after.files).sort(), Object.keys(before.files).sort(), 'no file created or removed');
  for (const f of Object.keys(before.files)) assert.equal(after.files[f], before.files[f], `${f} unchanged`);
  assert.equal(after.status, before.status);
});

test('no tmux session: it refuses rather than start one from inside an agent', () => {
  const noTmux = path.join(tmp, 'bin2');
  fs.mkdirSync(noTmux);
  fs.writeFileSync(path.join(noTmux, 'tmux'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const r = run([], { PATH: `${noTmux}${path.delimiter}${process.env.PATH}` });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no tmux session "home"/);
});

test('the kit lets a box operator look, and nothing else', () => {
  const r = repo('guarded');
  const op = { DEVTEAM_ROLE: 'operator', TMUX: 'x', TMUX_PANE: '%7' };
  for (const c of [['status'], ['fleet', 'status', '--json', '--no-fetch'], ['settings', '--get', 'main_branch'], ['supervisor-session'], ['questions', '--json'], ['log', '--json'], ['messages', '--to', 'supervisor', '--open'], ['knowledge'], ['knowledge', '--kind', 'fact'], ['goal'], ['goal', 'list']]) assert.equal(dtIn(r, c, op).status, 0, c.join(' '));
  for (const c of [['merge', 't-1'], ['fleet', 'park', '--reason', 'x'], ['fleet', 'unpark'], ['answer', 'q', 'yes'], ['send', 'supervisor', 'hi'], ['knowledge', 'add', '--kind', 'fact', '--statement', 'x'], ['knowledge', 'set', 'k-1'], ['goal', 'add', '--title', 'x'], ['goal', 'set', 'g-1'], ['goal', 'status', 'g-1', 'met'], ['goal', 'hold', 'g-1', 'park'], ['goal', 'reading', 'g-1', '--run'], ['ticket', 'show', 't-1'], ['dashboard-data'], ['ask', '--question', 'q', '--kind', 'x']]) { const x = dtIn(r, c, op); assert.notEqual(x.status, 0, c.join(' ')); assert.match(x.stderr, /only reads|owner commands/, c.join(' ')); }
  assert.ok(!fs.existsSync(path.join(r, 'docs/devteam/run/supervisor-pane')), 'and it is never taken for the supervisor\'s pane');
});
