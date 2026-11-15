// recover --machine as the box runs it, the box's boot and its hub window, and box-deploy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hasTmux, until, write } from './lib/kit.mjs';
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
const hubLine = (prefix) => { const l = devteamDev().find((x) => x.trim().startsWith(prefix)); assert.ok(l, `devteam-dev's line ${prefix}`); return l; };
const hubFakes = path.join(tmp, 'hub-fakes');
write(path.join(hubFakes, 'tmux'), '#!/bin/sh\n{ for a; do printf \'%s\\037\' "$a"; done; echo; } >> "$CALLS"\ncase $1 in\n  has-session) exit "${HAS_SESSION_EXIT:-1}" ;;\n  list-windows) [ -n "${WINDOWS+x}" ] || exit 1; printf \'%s\' "$WINDOWS" ;;\nesac\nexit 0\n');
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
  const line = hubLine('timeout 20 tmux list-windows -t =home');
  const there = bootHub(line, { WINDOWS: 'operator\nshell\nhub\n', HAS_SESSION_EXIT: '0' });
  assert.deepEqual(made(there.calls), []);
  assert.deepEqual(there.calls[0].slice(0, 3), ['list-windows', '-t', '=home']);
  const gone = bootHub(line, { WINDOWS: 'operator\nshell\nhubby\n', HAS_SESSION_EXIT: '0' });
  assert.deepEqual(made(gone.calls).map((c) => c.slice(0, 6)), [['new-window', '-d', '-t', '=home:', '-n', 'hub']]);
  const noSession = bootHub(line, { HAS_SESSION_EXIT: '1' });
  assert.deepEqual(made(noSession.calls).map((c) => c.slice(0, 6)), [['new-session', '-d', '-s', 'home', '-n', 'hub']]);
});

test('the boot\'s hub lines sit where the boot needs them', () => {
  assert.ok(fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8').split('\n').includes('ENV DEVTEAM_IMAGE_HUB=4320'));
  const d = devteamDev();
  const at = (pred, what) => { const i = d.findIndex(pred); assert.ok(i >= 0, what); return i; };
  const operator = at((l) => l.trim().startsWith('tmux new-session -d -s home -n operator'), 'the home session');
  const defs = at((l) => l.startsWith('hub_window() {'), 'hub_window');
  const call = at((l) => l === "timeout 20 tmux list-windows -t =home -F '#{window_name}' 2>/dev/null | grep -qx hub || hub_window", 'the call, only if home has no hub yet');
  const wait = at((l) => l === 'hub_wait || :', 'the wait');
  const dash = at((l) => l === 'for k in "$HOME"/code/*/docs/devteam/scripts/devteam.mjs; do', 'the dashboard loop');
  assert.ok(operator < defs && defs < call && call < wait && wait < dash, [operator, defs, call, wait, dash].join(' '));
  const minute = at((l) => l.startsWith('  timeout 20 tmux list-windows -t =home'), 'the minute loop\'s line');
  assert.equal(d[minute].trim(), d[call], 'the same line at boot and each minute');
  assert.equal(d[minute - 1], '  sleep 60');
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
