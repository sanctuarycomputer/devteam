// cloud/box-supervisors: which supervisors a box brings back, and which it leaves alone; and that
// the kit lets a box's operator look but not act. A shim stands in for tmux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
fs.writeFileSync(path.join(shim, 'tmux'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${tmuxLog}'\ncase "$1" in\n  list-panes) cat '${panesFile}' 2>/dev/null ;;\n  new-window) echo '%9' ;;\nesac\nexit 0\n`, { mode: 0o755 });
const baseEnv = { ...process.env, HOME: home, PATH: `${shim}${path.delimiter}${process.env.PATH}`, DEVTEAM_NODE: process.execPath };
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
  fs.writeFileSync(panesFile, `%1\tmine\t${h}\tclaude\n%2\tdash-lone\t${path.join(code, 'lone')}\tnode\n`);
  const up = lines(run(['--all', '--dry-run']));
  assert.match(up['home-repo'], /already running/);
  assert.match(up.lone, /^would start fresh/, 'a dashboard is not a supervisor');
  fs.rmSync(panesFile);

  // a real restore: the window, the noted pane, the first message, the list used up
  fs.writeFileSync(tmuxLog, '');
  const real = lines(run());
  assert.match(real['home-repo'], /^resumed session 11111111-.*asked to get: config\/master\.key/);
  assert.equal(fs.readFileSync(path.join(h, 'docs/devteam/run/supervisor-pane'), 'utf8'), '%9');
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
  for (const c of [['status'], ['fleet', 'status', '--json', '--no-fetch'], ['settings', '--get', 'main_branch'], ['supervisor-session']]) assert.equal(dtIn(r, c, op).status, 0, c.join(' '));
  for (const c of [['merge', 't-1'], ['fleet', 'park', '--reason', 'x'], ['fleet', 'unpark'], ['answer', 'q', 'yes'], ['send', 'supervisor', 'hi']]) { const x = dtIn(r, c, op); assert.notEqual(x.status, 0, c.join(' ')); assert.match(x.stderr, /only reads|owner commands/, c.join(' ')); }
  assert.ok(!fs.existsSync(path.join(r, 'docs/devteam/run/supervisor-pane')), 'and it is never taken for the supervisor\'s pane');
});
