// recover --machine as the box runs it, the box's boot and its hub window, and box-deploy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasTmux, realTmux, until, write } from './lib/kit.mjs';
import { agent, baseEnv, box, conversation, dtIn, home, KIT, kitAt, link, machine, nowhere, prompt, repo, REPO, shown, SID, tmp, tmuxSh } from './lib/machine-fixture.mjs';

const lines = (r) => Object.fromEntries(r.stdout.trim().split('\n').filter(Boolean).map((l) => { const i = l.indexOf(': '); return [l.slice(0, i), l.slice(i + 2)]; }));
const OLD = ['v0.25.0', 'v0.28.0', 'v0.30.0'];
const tagsMissing = () => [...OLD, 'v0.32.0'].filter((t) => !kitAt(t));
const skipOld = () => { const m = tagsMissing(); if (m.length && process.env.CI) throw new Error(`no ${m.join(', ')} in this checkout`); return m.length ? `no ${m.join(', ')} in this checkout` : false; };
const claudeCalls = (r) => (fs.existsSync(path.join(r, '.claude-calls')) ? fs.readFileSync(path.join(r, '.claude-calls'), 'utf8').trim().split('\n').filter(Boolean) : []);

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
      assert.match(claudeCalls(r)[0], /keep the loop, as before the restart: run the tick \(§3\) now, then wait with devteam\.mjs wait and tick again when it returns, until the owner stops you\. A summary to the owner doesn't end it\./, 'and it ends by keeping the loop');
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

// The image's hub, from cloud/Dockerfile's devteam-dev: its window (hub_window), the wait before the
// dashboards (hub_wait), and the minute loop's line that brings the window back. Run under sh with a
// tmux, curl and timeout of the test's own first on PATH: tmux notes each call's arguments, split by
// \x1f, and answers has-session with $HAS_SESSION_EXIT and list-windows with $WINDOWS (failing when unset);
// curl prints $BODY, or fails as a refused connection does (7) when it is unset.
const devteamDev = () => {
  const df = fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8').split('\n');
  const from = df.indexOf("COPY --chmod=755 <<'EOF' /usr/local/bin/devteam-dev");
  return df.slice(from + 1, df.indexOf('EOF', from));
};
const HUB_CHECK = "timeout 20 tmux list-windows -t =home -F '#{window_name}' 2>/dev/null | grep -qx hub || hub_window";
const hubLine = (prefix) => { const l = devteamDev().find((x) => x.trim().startsWith(prefix)); assert.ok(l, `devteam-dev's line ${prefix}`); return l; };
const hubFakes = path.join(tmp, 'hub-fakes');
write(path.join(hubFakes, 'tmux'), '#!/bin/sh\n{ for a; do printf \'%s\\037\' "$a"; done; echo; } >> "$CALLS"\ncase $1 in\n  has-session) exit "${HAS_SESSION_EXIT:-1}" ;;\n  list-sessions) exit "${LIST_SESSIONS_EXIT:-0}" ;;\n  list-windows) [ -n "${WINDOWS+x}" ] || exit 1; printf \'%s\' "$WINDOWS" ;;\nesac\nexit 0\n');
write(path.join(hubFakes, 'curl'), '#!/bin/sh\necho "$*" >> "$CURLS"\n[ -n "${BODY+x}" ] || exit 7\nprintf \'%s\' "$BODY"\n');
write(path.join(hubFakes, 'timeout'), '#!/bin/sh\nshift\nexec "$@"\n');
for (const f of ['tmux', 'curl', 'timeout']) fs.chmodSync(path.join(hubFakes, f), 0o755);
const bootHub = (body, env = {}) => {
  const h = fs.mkdtempSync(path.join(tmp, 'hub-boot-'));
  const calls = path.join(h, '.calls');
  const curls = path.join(h, '.curls');
  const script = [hubLine('note() {'), hubLine('hub_window() {'), hubLine('hub_wait() {'), body].join('\n');
  const t0 = Date.now();
  const r = spawnSync('sh', ['-c', script], { cwd: h, encoding: 'utf8', env: { PATH: `${hubFakes}:/usr/bin:/bin`, HOME: h, CALLS: calls, CURLS: curls, DEVTEAM_IMAGE_HUB: '4320', ...env } });
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : []);
  const boxLog = path.join(h, 'box.log');
  return { ...r, ms: Date.now() - t0, home: h, calls: read(calls).map((l) => l.split('\x1f').slice(0, -1)), curls: read(curls), boxLog: fs.existsSync(boxLog) ? fs.readFileSync(boxLog, 'utf8') : null };
};
const made = (calls) => calls.filter((c) => c[0] === 'new-window' || c[0] === 'new-session');

test('the box\'s boot starts the image\'s hub in home:hub, from the image\'s kit, with nothing from tmux\'s environment', () => {
  const r = bootHub('hub_window', { HAS_SESSION_EXIT: '0', DEVTEAM_KIT_RELEASE: 'v1.2.3' });
  assert.equal(r.status, 0, r.stderr);
  const [w, ...more] = made(r.calls);
  assert.equal(more.length, 0);
  // =home: with the colon: a bare =home is first a window named home in the current session
  assert.deepEqual(w.slice(0, -1), ['new-window', '-d', '-t', '=home:', '-n', 'hub', '-c', r.home], 'cwd $HOME, which is no checkout: the hub\'s children take no writer from a branch');
  const cmd = w.at(-1);
  assert.ok(cmd.startsWith('while :; do /usr/bin/env ') && cmd.endsWith('; sleep 1; done'), cmd);
  for (const part of ['-u NODE_OPTIONS', '-u NODE_PATH', '-u NODE_REPL_EXTERNAL_MODULE', '-u DEVTEAM_HOME', '-u DEVTEAM_RUN', '-u DEVTEAM_PROJECT', '-u DEVTEAM_HUB_PORT', `HOME='${r.home}'`]) assert.ok(cmd.includes(` ${part} `), part);
  assert.ok(cmd.includes(" PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node /opt/devteam/kit/scripts/devteam.mjs hub --release 'v1.2.3'; "), 'root\'s PATH, the image\'s node and kit, the image\'s release');
  // no home session: one is made, with the hub as its window
  const s = bootHub('hub_window', { HAS_SESSION_EXIT: '1', DEVTEAM_KIT_RELEASE: 'v1.2.3' });
  const [n, ...none] = made(s.calls);
  assert.equal(none.length, 0);
  assert.deepEqual(n.slice(0, -1), ['new-session', '-d', '-s', 'home', '-n', 'hub', '-c', s.home]);
  assert.equal(n.at(-1), cmd.replace(r.home, s.home));
  // a release that isn't plainly vN.N.N goes as '': the hub says so and serves with none
  for (const rel of ['v0.52.0-rc1', 'v1.2.3\nv1.2.3', 'v1.2.3\n', '1.2.3', 'v1.2', '', "v1.2.3'; touch x; '", 'vv1.2.3']) {
    const o = bootHub('hub_window', { HAS_SESSION_EXIT: '0', DEVTEAM_KIT_RELEASE: rel });
    assert.ok(made(o.calls)[0].at(-1).includes(" hub --release ''; "), JSON.stringify(rel));
    assert.ok(!fs.existsSync(path.join(o.home, 'x')));
  }
});

test('the boot waits for the hub at most DEVTEAM_HUB_WAIT_SECONDS, and notes it gave up', () => {
  const r = bootHub('hub_wait; echo rc=$?', { DEVTEAM_HUB_WAIT_SECONDS: '1' });
  assert.equal(r.stdout.trim(), 'rc=1', r.stderr);
  assert.ok(r.ms < 5000, `${r.ms} ms`);
  assert.ok(r.curls.length >= 1 && r.curls.length <= 3, `${r.curls.length} tries, a second apart`);
  for (const c of r.curls) assert.match(c, / http:\/\/127\.0\.0\.1:4320\/instances\.json$/);
  assert.match(r.boxLog, /^\S+Z hub: nothing answered hub 1 on 127\.0\.0\.1:4320 after 1s; going on \(see ~\/\.devteam\/hub-4320\.log\)\n$/);
  const up = bootHub('hub_wait; echo rc=$?', { DEVTEAM_HUB_WAIT_SECONDS: '1', BODY: '{"hub":1,"kit":"v1.2.3","image":true,"instances":[]}' });
  assert.equal(up.stdout.trim(), 'rc=0');
  assert.equal(up.curls.length, 1);
  assert.equal(up.boxLog, null, 'nothing noted');
  assert.equal(bootHub('hub_wait; echo rc=$?', { DEVTEAM_HUB_WAIT_SECONDS: '1', BODY: '{"hub":12,"instances":[]}' }).stdout.trim(), 'rc=1', 'not hub 1');
  // a wait that isn't a plain number (08 is no number to sh's arithmetic) is 15 s, never a shell that dies before the dashboards
  for (const w of ['15s', '08', '010', '-1']) assert.equal(bootHub('hub_wait; echo rc=$?', { DEVTEAM_HUB_WAIT_SECONDS: w, BODY: '{"hub":1,"instances":[]}' }).stdout.trim(), 'rc=0', w);
});

test('the minute loop recreates home:hub only when it is gone', () => {
  const line = hubLine(HUB_CHECK);
  const there = bootHub(line, { WINDOWS: 'operator\nshell\nhub\n', HAS_SESSION_EXIT: '0' });
  assert.deepEqual(made(there.calls), []);
  assert.deepEqual(there.calls[0].slice(0, 3), ['list-windows', '-t', '=home']);
  const gone = bootHub(line, { WINDOWS: 'operator\nshell\nhubby\n', HAS_SESSION_EXIT: '0' });
  assert.deepEqual(made(gone.calls).map((c) => c.slice(0, 6)), [['new-window', '-d', '-t', '=home:', '-n', 'hub']]);
  const noSession = bootHub(line, { HAS_SESSION_EXIT: '1' });
  assert.deepEqual(made(noSession.calls).map((c) => c.slice(0, 6)), [['new-session', '-d', '-s', 'home', '-n', 'hub']]);
  // no tmux server at all: hub_window starts none (a server holding only the hub hid a lost box);
  // the minute loop's restore starts everything
  const noServer = bootHub(line, { HAS_SESSION_EXIT: '1', LIST_SESSIONS_EXIT: '1' });
  assert.deepEqual(made(noServer.calls), []);
});

test('the boot\'s hub lines sit where the boot needs them', () => {
  assert.ok(fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8').split('\n').includes('ENV DEVTEAM_IMAGE_HUB=4320'));
  const d = devteamDev();
  const at = (pred, what) => { const i = d.findIndex(pred); assert.ok(i >= 0, what); return i; };
  at((l) => l.trim().startsWith('timeout 20 tmux new-session -d -s home -n operator'), 'the home session, in start_operator');
  const operator = at((l) => l === 'start_operator boot', 'the operator, at boot');
  const defs = at((l) => l.startsWith('hub_window() {'), 'hub_window');
  const call = at((l) => l === HUB_CHECK, 'the call, only if home has no hub yet');
  const wait = at((l) => l === 'hub_wait || :', 'the wait');
  const dash = at((l) => l === 'start_dashboards', 'the dashboards');
  const recover = at((l) => l === 'start_recover wait', 'box-recover, waiting its turn');
  assert.ok(operator < defs && defs < call && call < wait && wait < dash && dash < recover, [operator, defs, call, wait, dash, recover].join(' '));
  const loop = d.findIndex((l, i) => i > recover && l === 'while :; do');
  assert.deepEqual(d.slice(loop + 1, loop + 3), ['  sleep 60', '  [ -e "$HOME/.box/stopping" ] && continue'], 'each minute, unless the box is stopping');
  const done = d.indexOf('done &', loop);
  assert.ok(d.slice(loop, done).filter((l) => l.trim() === HUB_CHECK).length === 2, 'the hub in the restore, and each minute');
});

test('hub_window makes home:hub on a real tmux even when another session has a window named home', { skip: !hasTmux }, async () => {
  const swap = '/usr/local/bin/node /opt/devteam/kit/scripts/devteam.mjs hub';
  const line = hubLine('hub_window() {');
  assert.ok(line.includes(swap));
  const kill = () => { tmuxSh(['kill-session', '-t', '=home']); tmuxSh(['kill-session', '-t', '=kit49-other']); };
  kill();
  try {
    assert.equal(tmuxSh(['new-session', '-d', '-s', 'home', '-n', 'operator', 'sleep 600']).status, 0);
    // the next second, so the next session's session_created is later than home's
    const created = Number(tmuxSh(['display-message', '-p', '-t', '=home:', '#{session_created}']).stdout.trim());
    assert.ok(created > 0, 'home\'s session_created');
    await until(() => Math.floor(Date.now() / 1000) > created, 'the second after home was made');
    // made after home, so it is the session tmux reads a bare name in
    assert.equal(tmuxSh(['new-session', '-d', '-s', 'kit49-other', '-n', 'home', 'sleep 600']).status, 0);
    const order = tmuxSh(['list-sessions', '-F', '#{session_created} #{session_name}']).stdout.split('\n').filter((l) => / (home|kit49-other)$/.test(l)).sort().map((l) => l.split(' ')[1]);
    assert.deepEqual(order, ['home', 'kit49-other']);
    const h = fs.mkdtempSync(path.join(tmp, 'hub-real-'));
    const r = spawnSync('sh', ['-c', `${line.replace(swap, 'sleep 600; :')}\nhub_window`], { cwd: h, encoding: 'utf8', env: { ...baseEnv, HOME: h, DEVTEAM_KIT_RELEASE: 'v1.2.3' } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(tmuxSh(['list-windows', '-t', '=home', '-F', '#{window_name}']).stdout.trim().split('\n'), ['operator', 'hub']);
    assert.deepEqual(tmuxSh(['list-windows', '-t', '=kit49-other', '-F', '#{window_name}']).stdout.trim().split('\n'), ['home'], 'the other session left alone');
  } finally { kill(); }
});

// box-deploy.yml's step, as a release runs it (Actions' bash flags), from this checkout (box-pins runs
// only in the kit's own repo: a remote naming sanctuarycomputer/devteam, as CI's checkout has) and with no hook: the stamp is checked before the hook is read, so even a run without
// the secret refuses a release cut without its release-prep PR.
test('box-deploy refuses a release whose stamp isn\'t its tag, before it reads the hook', () => {
  const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'box-deploy.yml'), 'utf8');
  const lines = wf.split('\n');
  const from = lines.indexOf('        run: |');
  assert.ok(from > 0, 'the deploy step\'s run block');
  const block = [];
  for (const l of lines.slice(from + 1)) { if (l.trim() && !l.startsWith(' '.repeat(10))) break; block.push(l.slice(10)); }
  const script = block.join('\n');
  const stamp = /^ARG DEVTEAM_RELEASE=(v\S+)$/m.exec(fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8'))[1];
  const env = { ...process.env, HOOK: '' };
  for (const k of ['DEVTEAM_HOME', 'DEVTEAM_RUN', 'DEVTEAM_TICKET', 'DEVTEAM_ROLE']) delete env[k];
  const run = (tag) => spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], { cwd: REPO, encoding: 'utf8', env: { ...env, TAG: tag } });
  const ok = run(stamp);
  assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr} (box-pins needs this checkout's remote to name sanctuarycomputer/devteam)`);
  assert.match(ok.stdout, /no RENDER_DEPLOY_HOOK/);
  const bad = run('v0.0.1');
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /^refusing v0\.0\.1: .*box-pins bump --release v0\.0\.1/m);
  assert.doesNotMatch(bad.stdout, /no RENDER_DEPLOY_HOOK/, 'refused before the hook is read');
  // what the image is built from: every path the Dockerfile copies; and every rule there was
  assert.match(script, /^inputs=\(cloud docs\/devteam\)$/m);
  for (const rule of ["github.repository == 'sanctuarycomputer/devteam' && !github.event.release.prerelease", 'environment: box', 'git merge-base --is-ancestor "$SHA" origin/main', 'TAG: ${{ github.event.release.tag_name }}']) assert.ok(wf.includes(rule), rule);
  const copies = fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8').split('\n').filter((l) => l.startsWith('COPY ')).map((l) => l.split(/\s+/).slice(1).filter((w) => !w.startsWith('--'))[0]).filter((src) => !src.startsWith('<<'));
  assert.ok(copies.length >= 3, copies.join(' '));
  for (const src of copies) assert.ok(/^(cloud|docs\/devteam)(\/|$)/.test(src), `${src} is an input`);
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

// The box's tmux (cloud/Dockerfile, /usr/bin/tmux, Debian's diverted to tmux.distrib): two guards. Run here
// against the real tmux, every server on a socket of the test's own: the wrapper's exec of
// /usr/bin/tmux.distrib points at this machine's tmux, and the box's socket at one the test made.
const dockerScript = (dest) => {
  const df = fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8').split('\n');
  const from = df.indexOf(`COPY --chmod=755 <<'EOF' ${dest}`);
  assert.ok(from >= 0, `the Dockerfile writes ${dest}`);
  return df.slice(from + 1, df.indexOf('EOF', from)).join('\n') + '\n';
};
test('the box\'s tmux refuses a kill-server aimed at the box, and honours a private TMUX_TMPDIR inside a pane', { skip: !hasTmux || !realTmux }, () => {
  const uid = String(process.getuid());
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tw-')));
  const boxDir = path.join(d, 'b');
  const boxSock = path.join(boxDir, `tmux-${uid}`, 'default');
  let text = dockerScript('/usr/bin/tmux');
  assert.ok(text.includes('\nexec /usr/bin/tmux.distrib "$@"\n') && text.includes('\n  box=/tmp/tmux-$(id -u dev 2>/dev/null)/default\n'));
  // under dash where there is one: the box's /bin/sh
  if (fs.existsSync('/bin/dash')) text = text.replace(/^#!\/bin\/sh\n/, '#!/bin/dash\n');
  text = text.replace('\nexec /usr/bin/tmux.distrib "$@"\n', `\nexec '${realTmux}' "$@"\n`).replace('\n  box=/tmp/tmux-$(id -u dev 2>/dev/null)/default\n', `\n  box='${boxSock}'\n`);
  const wrapper = path.join(d, 'tmux');
  fs.writeFileSync(wrapper, text, { mode: 0o755 });
  assert.equal(spawnSync('sh', ['-n', wrapper]).status, 0, 'sh -n');
  const env = (extra = {}) => { const e = { ...process.env, ...extra }; for (const k of ['TMUX', 'TMUX_PANE', 'TMUX_TMPDIR', 'DEVTEAM_ALLOW_KILL_SERVER']) if (!(k in extra)) delete e[k]; return e; };
  const real = (args, extra) => spawnSync(realTmux, args, { encoding: 'utf8', env: env(extra) });
  const wrap = (args, extra) => spawnSync(wrapper, args, { encoding: 'utf8', env: env(extra) });
  const boxUp = () => real(['-S', boxSock, 'has-session', '-t', '=home']).status === 0;
  const pane = `${boxSock},${process.pid},0`;
  try {
    // the box: a server on the default socket under its tmpdir, as dev's is under /tmp
    fs.mkdirSync(boxDir);
    assert.equal(real(['-f', '/dev/null', 'new-session', '-d', '-s', 'home', 'sleep 600'], { TMUX_TMPDIR: boxDir }).status, 0);
    assert.ok(boxUp());
    const link = path.join(d, 'l');
    fs.symlinkSync(boxSock, link);
    const refused = [
      [['kill-server'], { TMUX_TMPDIR: boxDir }, 'the default socket'],
      [['-S', boxSock, 'kill-server'], {}, '-S'],
      [[`-S${boxSock}`, 'kill-server'], {}, '-S, joined'],
      [['-u', '-S', boxSock, 'kill-ser'], {}, 'a prefix tmux takes for kill-server'],
      [['-L', 'default', 'kill-server'], { TMUX_TMPDIR: boxDir }, '-L under the tmpdir'],
      [['kill-server'], { TMUX: pane }, '$TMUX, in a pane of the box'],
      [['-S', boxSock, 'has-session', ';', 'kill-server'], {}, 'after ;'],
      [['-S', boxSock, 'has-session;', 'kill-server'], {}, 'after a word ending in ;'],
      [['-S', boxSock, 'kill-server'], { DEVTEAM_ALLOW_KILL_SERVER: '0' }, 'anything but 1'],
      [['-S', boxSock, '--', 'kill-server'], {}, 'after --'],
      [['-Ldefault', 'kill-server'], { TMUX_TMPDIR: boxDir }, '-L, joined'],
      [['-S', path.join(boxDir, `tmux-${uid}`, '..', `tmux-${uid}`, 'default'), 'kill-server'], {}, 'a path with ..'],
      [['-S', link, 'kill-server'], {}, 'a symlink to the socket'],
      [['kill-server'], { TMUX_TMPDIR: `${boxDir}/` }, 'a tmpdir with a trailing /'],
      [['-S', boxSock, 'if-shell', 'true', 'kill-server'], {}, 'run by if-shell'],
      [['-S', boxSock, 'if', '-F', '1', 'kill-server'], {}, 'run by if'],
      [['-S', boxSock, 'if-shell', 'true', 'new -d; kill-server'], {}, 'in if-shell\'s command string'],
      [['-S', boxSock, 'confirm-before', '-p', 'sure?', 'kill-server'], {}, 'run by confirm-before'],
      [['-S', boxSock, 'set-hook', '-g', 'client-detached', 'kill-server'], {}, 'set as a hook'],
      [['-S', boxSock, 'bind-key', 'X', 'kill-server'], {}, 'bound to a key'],
    ];
    for (const [args, extra, what] of refused) {
      const r = wrap(args, extra);
      assert.equal(r.status, 1, what);
      assert.equal(r.stderr, 'tmux: kill-server refused: this would stop every supervisor on the box; use a private server: tmux -S <socket> …\n', what);
      assert.ok(boxUp(), `${what}: the box's server lives`);
    }
    // kill-server as a word that is no command (a target, a format) goes to tmux
    for (const args of [['has-session', '-t', 'kill-server'], ['display-message', '-p', 'kill-server'], ['list-windows', '-t', '=home', '-F', 'kill-server'], ['if-shell', 'true', 'display -p x', ';', 'display-message', '-p', 'kill-server']]) {
      const r = wrap(['-S', boxSock, ...args]);
      assert.equal(r.status, real(['-S', boxSock, ...args]).status, args.join(' '));
      assert.ok(!r.stderr.includes('refused'), args.join(' '));
    }
    assert.equal(wrap(['-S', boxSock, 'display-message', '-p', 'kill-server']).stdout, 'kill-server\n');
    assert.ok(boxUp());
    // a private -L server beside the box's, named joined: killed, the box's left alone
    assert.equal(real(['-L', 'side', '-f', '/dev/null', 'new-session', '-d', 'sleep 600'], { TMUX_TMPDIR: boxDir }).status, 0);
    assert.equal(wrap(['-Lside', 'kill-server'], { TMUX_TMPDIR: boxDir }).status, 0, '-Lside is not the box');
    assert.notEqual(real(['-L', 'side', 'has-session'], { TMUX_TMPDIR: boxDir }).status, 0);
    assert.ok(boxUp());
    // a private -S server: made and killed through the wrapper
    const priv = path.join(d, 'p');
    assert.equal(wrap(['-S', priv, '-f', '/dev/null', 'new-session', '-d', '-s', 't', 'sleep 600']).status, 0);
    assert.equal(wrap(['-S', priv, 'kill-server']).status, 0, 'a private server may be killed');
    assert.notEqual(real(['-S', priv, 'has-session']).status, 0);
    assert.ok(boxUp());
    // the incident: in a pane of the box ($TMUX), a test meant a private server with TMUX_TMPDIR
    const mine = path.join(d, 'm');
    fs.mkdirSync(mine);
    const inPane = { TMUX: pane, TMUX_PANE: '%0', TMUX_TMPDIR: mine };
    assert.equal(wrap(['-f', '/dev/null', 'new-session', '-d', '-s', 't', 'sleep 600'], inPane).status, 0);
    assert.equal(real(['-S', path.join(mine, `tmux-${uid}`, 'default'), 'has-session', '-t', '=t']).status, 0, 'the session is on the private server');
    assert.notEqual(real(['-S', boxSock, 'has-session', '-t', '=t']).status, 0, 'and not on the box\'s');
    const k = wrap(['kill-server'], inPane);
    assert.equal(k.status, 0, k.stderr);
    assert.ok(boxUp(), 'the box\'s server lives');
    assert.notEqual(real(['-S', path.join(mine, `tmux-${uid}`, 'default'), 'has-session']).status, 0, 'the private one is gone');
    // a $TMUX inside the caller's own TMUX_TMPDIR is kept: a pane of that private server
    const other = path.join(mine, 'other');
    assert.equal(real(['-S', other, '-f', '/dev/null', 'new-session', '-d', '-s', 'o', 'sleep 600']).status, 0);
    assert.equal(wrap(['display-message', '-p', '#{socket_path}'], { TMUX: `${other},1,0`, TMUX_TMPDIR: mine }).stdout.trim(), other);
    // everything else passes straight through: arguments as given, and tmux's own exit codes
    const odd = ['a b', '"q"', "it's", '$HOME', '', 'x -S y', 'kill-server x', '\\;'];
    for (const a of odd) assert.equal(wrap(['-S', other, 'display-message', '-p', a]).stdout, real(['-S', other, 'display-message', '-p', a]).stdout, JSON.stringify(a));
    assert.equal(wrap(['-S', other, 'display-message', '-p', 'a b "q" it\'s $HOME']).stdout, 'a b "q" it\'s $HOME\n');
    assert.equal(wrap(['-S', other, 'has-session', '-t', '=nope']).status, real(['-S', other, 'has-session', '-t', '=nope']).status);
    assert.equal(wrap(['-S', other, 'kill-server']).status, 0);
    // a deliberate stop, as the box's own does
    assert.equal(wrap(['kill-server'], { TMUX_TMPDIR: boxDir, DEVTEAM_ALLOW_KILL_SERVER: '1' }).status, 0);
    assert.ok(!boxUp());
  } finally {
    for (const s of [boxSock, path.join(boxDir, `tmux-${uid}`, 'side'), path.join(d, 'p'), path.join(d, 'm', `tmux-${uid}`, 'default'), path.join(d, 'm', 'other')]) real(['-S', s, 'kill-server']);
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// The minute loop's restore, from cloud/Dockerfile's devteam-dev: the functions and one turn of the
// loop, under sh with a tmux of the test's own that keeps a server's state in files (its pid, each
// session's windows, the panes), and stand-ins for timeout, flock, node and box-recover.
const loopFakes = path.join(tmp, 'loop-fakes');
write(path.join(loopFakes, 'tmux'), `#!/bin/sh
{ for a; do printf '%s\\037' "$a"; done; echo; } >> "$CALLS"
cmd=$1; shift
t= s= n=
while [ $# -gt 0 ]; do case $1 in -t) t=$2; shift ;; -s) s=$2; shift ;; -n) n=$2; shift ;; -F|-c) shift ;; esac; shift; done
pid=$(cat "$ST/pid" 2>/dev/null)
[ "$pid" = hang ] && exit 124
[ "$cmd" = "$HANG" ] && exit 124
sess=\${t#=}; sess=\${sess%%:*}
case $cmd in
  display-message) [ -n "$pid" ] || exit 1; echo "$pid" ;;
  list-sessions) [ -n "$pid" ] || exit 1; ls "$ST"/win-* >/dev/null 2>&1 ;;
  has-session) [ -n "$pid" ] && [ -f "$ST/win-$sess" ] ;;
  list-windows) [ -n "$pid" ] && [ -f "$ST/win-$sess" ] || exit 1; cat "$ST/win-$sess" ;;
  list-panes) [ -n "$pid" ] || exit 1; cat "$ST/panes" 2>/dev/null ;;
  new-session) [ -n "$pid" ] || echo 900 > "$ST/pid"; echo "$n" >> "$ST/win-$s" ;;
  new-window) [ -n "$pid" ] && [ -f "$ST/win-$sess" ] || exit 1; case $t in *:0) [ -s "$ST/win-$sess" ] && exit 1 ;; esac; echo "$n" >> "$ST/win-$sess" ;;
  send-keys) [ -n "$pid" ] ;;
esac
`);
write(path.join(loopFakes, 'timeout'), '#!/bin/sh\nshift\nexec "$@"\n');
write(path.join(loopFakes, 'flock'), '#!/bin/sh\necho "$*" >> "$HOME/.flocks"\n[ -z "$LOCK_HELD" ]\n');
write(path.join(loopFakes, 'node'), '#!/bin/sh\n[ -z "$STOP_DURING" ] || : > "$HOME/.box/stopping"\ncase $* in *"settings --get tmux_session"*) cat .session 2>/dev/null || echo null ;; esac\n');
write(path.join(loopFakes, 'box-recover'), '#!/bin/sh\necho ran >> "$HOME/.recovers"\n');
for (const f of ['tmux', 'timeout', 'flock', 'node', 'box-recover']) fs.chmodSync(path.join(loopFakes, f), 0o755);
const minuteTurn = () => {
  const d = devteamDev();
  const fn = (name) => { const i = d.findIndex((l) => l.startsWith(`${name}() {`)); assert.ok(i >= 0, name); return d[i].trimEnd().endsWith('}') ? [d[i]] : d.slice(i, d.indexOf('}', i) + 1); };
  const first = d.indexOf('note_srv');
  assert.ok(first > 0, 'the server\'s pid, noted before the loop');
  assert.equal(d[first + 1], 'while :; do');
  assert.equal(d[first + 2], '  sleep 60');
  const body = d.slice(first + 3, d.indexOf('done &', first));
  const defs = [...fn('note'), ...fn('hub_window'), ...fn('start_operator'), ...fn('start_dashboards'), d.find((l) => l.startsWith('owed=')), ...fn('start_recover'), ...fn('note_srv')];
  // one turn: what the loop does each minute, with the pid as the last turn left it
  return [...defs, 'up="$HOME/.devteam-supervisors"', 'srv=$(cat "$HOME/.srv" 2>/dev/null)', 'for once in 1; do', ...body, 'done', 'echo "$srv" > "$HOME/.srv"', 'wait']
    .join('\n').replaceAll('/usr/local/bin/box-recover', `${loopFakes}/box-recover`).replaceAll('/usr/local/bin/node', `${loopFakes}/node`);
};
test('the minute loop brings back a lost tmux server as a boot does, from the list it had, and never overwrites that list', () => {
  const script = minuteTurn();
  const h = fs.mkdtempSync(path.join(tmp, 'loop-'));
  const st = path.join(h, '.st');
  fs.mkdirSync(path.join(h, '.box'), { recursive: true });
  fs.mkdirSync(st);
  const repoAt = (name, session) => {
    const r = path.join(h, 'code', name);
    write(path.join(r, 'docs', 'devteam', 'scripts', 'devteam.mjs'), '');
    write(path.join(r, 'docs', 'devteam', 'project', 'settings.md'), '');
    if (session) write(path.join(r, '.session'), `${session}\n`);
    return r;
  };
  const a = repoAt('a', 'proj-a');
  const b = repoAt('b');
  const up = path.join(h, '.devteam-supervisors');
  const paneOf = (r, p) => write(path.join(r, 'docs', 'devteam', 'run', 'supervisor-pane'), `${p}\n`);
  const state = ({ pid, home, panes, sessions = {} }) => {
    for (const f of fs.readdirSync(st)) fs.rmSync(path.join(st, f));
    if (pid) fs.writeFileSync(path.join(st, 'pid'), `${pid}\n`);
    for (const [s, ws] of Object.entries({ ...sessions, ...(home ? { home } : {}) })) fs.writeFileSync(path.join(st, `win-${s}`), ws.map((w) => `${w}\n`).join(''));
    if (panes !== undefined) fs.writeFileSync(path.join(st, 'panes'), panes);
  };
  const calls = path.join(h, '.calls');
  const turn = (env = {}) => {
    fs.rmSync(calls, { force: true });
    const r = spawnSync(fs.existsSync('/bin/dash') ? '/bin/dash' : 'sh', ['-c', script], { cwd: h, encoding: 'utf8', env: { PATH: `${loopFakes}:/usr/bin:/bin`, HOME: h, ST: st, CALLS: calls, DEVTEAM_KIT_RELEASE: 'v1.2.3', ...env } });
    assert.equal(r.status, 0, r.stderr);
    return (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) : []).map((l) => l.split('\x1f').slice(0, -1));
  };
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
  const recovers = () => (read(path.join(h, '.recovers')) ?? '').split('\n').filter(Boolean).length;
  const boxLog = () => (read(path.join(h, 'box.log')) ?? '').split('\n').filter(Boolean);
  const made = (c) => c.filter((x) => x[0] === 'new-session' || x[0] === 'new-window').map((x) => [x[0], x[x.indexOf('-n') + 1]]);
  assert.equal(spawnSync('sh', ['-n', '-c', script]).status, 0, 'sh -n');

  // steady: the same server, the operator there; the list is rewritten from the panes
  fs.writeFileSync(path.join(h, '.srv'), '100\n');
  paneOf(a, '%5'); paneOf(b, '%6');
  state({ pid: 100, home: ['operator', 'shell', 'hub'], panes: '%5 claude\n%6 bash\n' });
  let c = turn();
  assert.equal(read(up), `${a}\n`, 'a is up; b is back at a shell (stopped by the owner)');
  assert.equal(recovers(), 0);
  assert.deepEqual(boxLog(), []);
  assert.deepEqual(made(c), []);

  // the server replaced (the terminal started a new one, holding a shell): restore as a boot does
  fs.writeFileSync(up, `${a}\n${b}\n`);  // the last good list: both were up
  state({ pid: 200, home: ['bash'] });
  c = turn();
  assert.equal(read(up), `${a}\n${b}\n`, 'the list is not overwritten from the new server');
  assert.match(read(`${up}.boot`), new RegExp(`^\\d{10} ${a}\\n\\d{10} ${b}\\n$`), 'added to the restore list, timed, as at boot');
  assert.ok(!fs.existsSync(path.join(a, 'docs', 'devteam', 'run', 'supervisor-pane')), 'pane ids start again on a new server: the noted ones go');
  // the operator first (window 0 taken, so added), then the hub, every dashboard
  assert.deepEqual(made(c), [['new-window', 'operator'], ['new-window', 'operator'], ['new-window', 'hub'], ['new-session', 'dashboard'], ['new-window', 'dash-b']]);
  assert.ok(c.some((x) => x[0] === 'send-keys' && x.includes('-l') && /claude {2}--dangerously-skip-permissions/.test(x.at(-1))), 'the operator is started');
  assert.equal(recovers(), 1, 'box-recover ran');
  assert.equal(boxLog().length, 1);
  assert.match(boxLog()[0], /^\S+Z tmux server lost \(pid 100, now 200\): bringing the box back as at a boot/);
  assert.equal(read(path.join(h, '.srv')).trim(), '200', 'the new server is the one watched now');

  // the next minute, on the restored server: nothing again; the list follows the new server
  state({ pid: 200, home: ['bash', 'operator', 'hub'], panes: '' });
  c = turn();
  assert.equal(recovers(), 1, 'one restore per loss');
  assert.equal(boxLog().length, 1);
  assert.equal(read(up), '', 'nobody up yet');
  assert.match(read(`${up}.boot`), new RegExp(`^\\d{10} ${a}\\n\\d{10} ${b}\\n$`), 'the restore list still holds both');

  // no server at all: hub_window starts none; the restore starts it, operator first
  fs.writeFileSync(up, `${a}\n`);
  fs.rmSync(`${up}.boot`);
  state({});
  c = turn();
  assert.deepEqual(c.find((x) => x[0] === 'new-session' || x[0] === 'new-window').slice(0, 6), ['new-session', '-d', '-s', 'home', '-n', 'operator'], 'the operator\'s window starts the server, not the hub\'s');
  assert.equal(recovers(), 2);
  assert.match(read(`${up}.boot`), new RegExp(`^\\d{10} ${a}\\n$`));
  assert.equal(read(up), `${a}\n`);
  assert.match(boxLog()[1], /tmux server lost \(pid 200, now none\)/);
  assert.equal(read(path.join(h, '.srv')).trim(), '900');

  // the same server, only the operator's window gone: it comes back; the list and noted panes stay
  paneOf(a, '%5');
  state({ pid: 900, home: ['shell', 'hub'], panes: '%5 claude\n' });
  fs.rmSync(`${up}.boot`);
  c = turn();
  assert.ok(made(c).some((x) => x[1] === 'operator'));
  assert.ok(fs.existsSync(path.join(a, 'docs', 'devteam', 'run', 'supervisor-pane')), 'the noted pane is still right');
  assert.ok(!fs.existsSync(`${up}.boot`), 'nothing added: nobody went');
  assert.equal(recovers(), 2, 'no box-recover: nothing else was lost');
  assert.deepEqual(made(c).map((x) => x[1]).filter((n) => n !== 'operator'), [], 'nor any dashboard');
  assert.match(boxLog()[2], /the operator's window is gone/);

  // the pid not noted (tmux didn't answer in time): the next answer is the box's, no restore
  fs.writeFileSync(path.join(h, '.srv'), '\n');
  state({ pid: 900, home: ['operator', 'hub'], panes: '%5 claude\n' });
  turn();
  assert.equal(recovers(), 2);
  assert.equal(read(path.join(h, '.srv')).trim(), '900');
  assert.equal(read(up), `${a}\n`);

  // a supervisor its own kit marked stopped on the old server (closed since the list was kept) stays stopped
  fs.writeFileSync(up, `${a}\n${b}\n`);
  write(path.join(b, 'docs', 'devteam', 'run', 'supervisor-up.json'), '{\n  "up": false,\n  "kind": "tmux"\n}\n');
  state({ pid: 901, home: ['bash'] });
  turn();
  assert.match(read(`${up}.boot`), new RegExp(`^\\d{10} ${a}\\n$`), 'only a');
  assert.equal(recovers(), 3);

  // no server could be started: tried again each minute, the list added once
  state({});
  fs.chmodSync(st, 0o555);  // the fake tmux can start nothing
  turn();
  assert.equal(read(path.join(h, '.srv')).trim(), 'lost');
  const once = read(`${up}.boot`);
  turn();
  fs.chmodSync(st, 0o755);
  assert.equal(read(`${up}.boot`), once, 'not added again');
  assert.equal(recovers(), 5, 'box-recover each time');
  state({ pid: 902, home: ['bash'] });  // the terminal started one
  turn();
  assert.equal(read(`${up}.boot`), once);
  assert.equal(recovers(), 6, 'and the new server is restored');
  assert.equal(read(path.join(h, '.srv')).trim(), '902');
  fs.writeFileSync(`${up}.boot`, '');

  // a new server that already holds the operator, a project's dashboard and a home dash- window
  // (a restore that ran before): nothing of them is made twice, nor the operator typed into again
  state({ pid: 903, home: ['operator', 'hub', 'dash-b'], sessions: { 'proj-a': ['dashboard'] } });
  c = turn();
  assert.equal(recovers(), 7, 'box-recover still runs: it is safe to run again');
  assert.deepEqual(made(c), [], 'no window made');
  assert.ok(!c.some((x) => x[0] === 'send-keys'), 'no second claude in the operator');
  fs.writeFileSync(`${up}.boot`, '');

  // tmux not answering (a call timing out): nothing, the list as it was. Each of the two calls on
  // its own, with the server replaced, so a restore would show
  fs.writeFileSync(up, `${a}\n`);
  const before = recovers();
  for (const [hang, pid] of [['', 'hang'], ['display-message', 904], ['list-windows', 904]]) {
    state({ pid, home: ['bash'] });
    c = turn({ HANG: hang });
    assert.equal(recovers(), before, hang);
    assert.deepEqual(made(c), [], hang);
    assert.equal(read(up), `${a}\n`, hang);
    assert.equal(read(path.join(h, '.srv')).trim(), '903', hang);
  }

  // a box-recover already running (its lock held): none queued; the next minute starts it
  state({ pid: 905, home: ['bash'] });
  turn({ LOCK_HELD: '1' });
  assert.equal(recovers(), before, 'none started');
  const owed = path.join(h, '.box', 'recover.owed');
  assert.ok(fs.existsSync(owed), 'owed');
  assert.ok(!read(path.join(h, '.flocks')).includes('-w'), 'the loop never waits on the lock');
  state({ pid: 905, home: ['operator', 'hub'], panes: '' });
  turn({ LOCK_HELD: '1' });
  assert.equal(recovers(), before, 'still held: still owed');
  assert.ok(fs.existsSync(owed));
  turn();
  assert.equal(recovers(), before + 1, 'the lock free: it runs');
  assert.ok(!fs.existsSync(owed), 'paid');
  turn();
  assert.equal(recovers(), before + 1, 'and only once');
  fs.writeFileSync(`${up}.boot`, '');

  // the box starts stopping during a restore: what is under way finishes, box-recover doesn't start
  state({ pid: 906, home: ['bash'] });
  c = turn({ STOP_DURING: '1' });
  assert.ok(made(c).some((x) => x[1] === 'operator'));
  assert.equal(recovers(), before + 1, 'no box-recover once the box is stopping');
  fs.rmSync(path.join(h, '.box', 'stopping'));
  const afterStop = recovers();

  // the box stopping: nothing at all
  fs.writeFileSync(path.join(h, '.box', 'stopping'), '');
  state({});
  c = turn();
  assert.deepEqual(c, []);
  assert.equal(recovers(), afterStop);
});
