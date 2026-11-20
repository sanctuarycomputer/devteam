// Worktree installs (kit-596): a session or chore worktree reuses main's installed folder, skips its
// setup on resume, and runs it through machine-wide slots. Tests here cover the two settings, the
// setup runner and its slots, the marker and the copy, and the docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deadlineIn, hold, NOWHERE, pgrep, runAsync, SETTINGS, slotFleet, startOf, SUP } from './lib/box-memory-fixture.mjs';
import { fleetFixture, hasTmux, json, multiFixture, write } from './lib/kit.mjs';

// ---- DW1, DW2, DW3: the copy (worktree_copy), the marker (skip on resume), gate checkouts ----

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// A fleet whose main has lockfiles (one at the root, one a folder down, one two down), a copy key on
// no lockfile list, and gitignored installed folders main holds (node_modules, vendor, and one whose
// name has a space); its committed settings are patched with patch(F), and it has its own HOME.
function installFleet(name, patch) {
  const F = fleetFixture(name);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-home-'));
  const o = F.old;
  write(path.join(o, 'package-lock.json'), '{"lockfileVersion": 3}\n');
  write(path.join(o, '.deps-key'), 'deps 1\n');
  write(path.join(o, 'sub/yarn.lock'), '# yarn 1\n');
  write(path.join(o, 'a/b/yarn.lock'), '# yarn deep\n');
  write(path.join(o, '.gitignore'), `${fs.readFileSync(path.join(o, '.gitignore'), 'utf8')}node_modules/\nvendor/\nnode modules x/\n`);
  write(path.join(o, 'node_modules/marker.txt'), 'main\n');
  write(path.join(o, 'vendor/v.txt'), 'vendor\n');
  write(path.join(o, 'node modules x/x.txt'), 'x\n');
  const settings = (fn, msg) => {
    const f = path.join(o, SETTINGS);
    const txt = fs.readFileSync(f, 'utf8');
    const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
    const j = JSON.parse(m[1]);
    fn(j);
    fs.writeFileSync(f, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
    F.g(['add', '-A'], o);
    F.g(['commit', '-qm', msg], o);
    F.g(['push', '-q', 'origin', 'main'], o);
  };
  settings((j) => Object.assign(j, patch(F)), 'installs');
  const role = (extra = {}) => ({ ...SUP, HOME: home, DEVTEAM_CGROUP: NOWHERE, DEVTEAM_MEMINFO: NOWHERE, ...deadlineIn(30000), ...extra });
  const ticket = (id) => F.ok(o, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`ch/${id}/**`], done_when: ['the tidy check passes in CI'] })], SUP);
  const wt = (n) => path.join(o, '.worktrees', n);
  // the session's window closed (its tmux server is the fixture's own), then a resume
  const resume = (id, extra) => {
    const session = fs.readFileSync(path.join(o, 'docs/devteam/run/tmux-session'), 'utf8').trim();
    spawnSync('tmux', ['kill-window', '-t', `=${session}:${id}`], { env: F.env({}), stdio: 'ignore' });
    return F.run(o, ['worker', id, '--resume'], role(extra));
  };
  // the setups' records: one line per run, "<worktree> <what it saw>"
  const runs = (n) => { const f = path.join(F.base, 'runs.log'); return (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '').split('\n').filter(Boolean).map((l) => l.split(' ')).filter(([w]) => w === n).map(([, v]) => v ?? ''); };
  const marker = (w) => { const f = path.join(spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: w, encoding: 'utf8' }).stdout.trim(), 'devteam-setup'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const finish = () => { fs.rmSync(home, { recursive: true, force: true }); F.done(); };
  return { F, home, role, settings, ticket, wt, resume, runs, marker, finish };
}

const RECORD = (F) => `echo "$(basename "$PWD") $(test -f node_modules/marker.txt && echo had || echo none)" >> ${F.base}/runs.log`;

const COPY = [{ path: 'node_modules', key: 'package-lock.json' }, { path: 'vendor', key: '.deps-key' }, { path: 'node modules x', key: '.deps-key' }];

test('the two settings: defaults, a repo link may carry them, and validate types them', () => {
  const F = multiFixture('installs-settings');
  const { old, runIn, okIn } = F;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-home-'));
  const env = { HOME: home };
  try {
    assert.equal(okIn(old, ['settings', '--get', 'worktree_copy'], {}, env), '[]');
    assert.equal(okIn(old, ['settings', '--get', 'worktree_setup_always'], {}, env), 'false');
    const links = json(okIn(old, ['settings'], {}, env)).links;
    const withLink = (extra) => F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, ...extra } } });
    withLink({ worktree_copy: [{ path: 'node_modules', key: 'package-lock.json' }], worktree_setup_always: true });
    const good = runIn(old, ['validate'], {}, env);
    assert.equal(good.status, 0, good.err || good.out);
    withLink({ worktree_setup_always: 'yes' });
    const bad = runIn(old, ['validate'], {}, env);
    assert.notEqual(bad.status, 0);
    assert.match(`${bad.out}\n${bad.err}`, /worktree_setup_always is true or false/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); F.done(); }
});

test('2g: a setup that itself exits 75 or 124 is an ordinary failure (exit 1)', () => {
  const S = slotFleet('installs-2g', (F) => `exit "$(cat ${F.base}/2g.code)"`);
  try {
    for (const code of ['75', '124']) {
      fs.writeFileSync(path.join(S.F.base, '2g.code'), code);
      const r = S.start(`exit-${code}`);
      assert.equal(r.status, 1, `${code}: ${r.err}`);
      assert.match(r.err, /worktree_setup failed in /);
    }
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('1a-1d, 2a, 2a\', 2b: a new worktree gets main\'s installed folders when its key matches, and a resume skips a setup that passed', { skip: !hasTmux && 'no tmux' }, () => {
  const I = installFleet('installs-copy', (F) => ({ worktree_setup: RECORD(F), worktree_copy: COPY }));
  const { F } = I;
  try {
    I.ticket('ch-01-a');
    I.ticket('ch-02-b');
    // 1a: worker <id>, a new session worktree: copied before the setup ran
    const w = I.wt('ch-01-a');
    let r = F.run(F.old, ['worker', 'ch-01-a'], I.role());
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(I.runs('ch-01-a'), ['had'], 'the setup saw the copied node_modules');
    assert.equal(fs.readFileSync(path.join(w, 'node_modules/marker.txt'), 'utf8'), 'main\n');
    assert.equal(fs.readFileSync(path.join(w, 'vendor/v.txt'), 'utf8'), 'vendor\n');
    assert.equal(fs.readFileSync(path.join(w, 'node modules x/x.txt'), 'utf8'), 'x\n', 'a path with a space is copied too');
    assert.deepEqual(fs.readdirSync(w).filter((e) => e.includes('.devteam-copy-')), [], 'no temp folder left');
    // 1c: a copy, never a link: a write into the worktree's leaves main's alone
    const mainFile = path.join(F.old, 'node_modules/marker.txt');
    assert.notEqual(fs.statSync(path.join(w, 'node_modules/marker.txt')).ino, fs.statSync(mainFile).ino);
    assert.equal(fs.lstatSync(path.join(w, 'node_modules')).isSymbolicLink(), false);
    fs.writeFileSync(path.join(w, 'node_modules/marker.txt'), 'changed in the worktree\n');
    assert.equal(fs.readFileSync(mainFile, 'utf8'), 'main\n');
    // 2a: the marker, in the worktree's own git dir, outside the tree
    const m = I.marker(w);
    assert.ok(m, 'a marker after a passing setup');
    assert.equal(m.v, 1);
    assert.equal(m.setup, sha(RECORD(F)));
    assert.deepEqual(m.files, {
      '.deps-key': sha(fs.readFileSync(path.join(w, '.deps-key'))),
      'package-lock.json': sha(fs.readFileSync(path.join(w, 'package-lock.json'))),
      'sub/yarn.lock': sha(fs.readFileSync(path.join(w, 'sub/yarn.lock'))),
    });
    assert.equal(F.g(['status', '--porcelain'], w), '', 'nothing new in the worktree');
    // 2b: a resume after the window closed runs no setup
    r = I.resume('ch-01-a');
    assert.equal(r.status, 0, r.err);
    assert.equal(I.runs('ch-01-a').length, 1, 'no setup on a matching resume');
    // 2a': a copy key changed in the worktree: the resume runs it again, and the copy (there already) is left as it is
    fs.writeFileSync(path.join(w, '.deps-key'), 'deps 2\n');
    // stale temp copies a killed seed left are swept whenever the entry is looked at, even one that
    // copies nothing now (its folder is there, its key differs); a live pid's is left alone
    const dead = spawnSync('true').pid;
    for (const x of [`node_modules.devteam-copy-${dead}`, `vendor.devteam-copy-${dead}`, `vendor.devteam-copy-${process.pid}`]) write(path.join(w, x, 'half.txt'), 'half\n');
    r = I.resume('ch-01-a');
    assert.equal(r.status, 0, r.err);
    assert.equal(I.runs('ch-01-a').length, 2, 'a changed copy key runs the setup again');
    assert.deepEqual(fs.readdirSync(w).filter((e) => e.includes('.devteam-copy-')), [`vendor.devteam-copy-${process.pid}`], 'the dead pids\' temp copies are swept, the live one\'s kept');
    fs.rmSync(path.join(w, `vendor.devteam-copy-${process.pid}`), { recursive: true, force: true });
    assert.equal(fs.readFileSync(path.join(w, 'node_modules/marker.txt'), 'utf8'), 'changed in the worktree\n', 'a resume never overwrites the worktree\'s own install');
    assert.equal(I.marker(w).files['.deps-key'], sha('deps 2\n'));
    // an installed folder deleted (its key still main's): the marker matches, but the resume runs the setup, copying it back first
    fs.rmSync(path.join(w, 'node_modules'), { recursive: true, force: true });
    r = I.resume('ch-01-a');
    assert.equal(r.status, 0, r.err);
    assert.equal(I.runs('ch-01-a').length, 3, 'a deleted node_modules runs the setup again');
    assert.equal(I.runs('ch-01-a')[2], 'had', 'copied back from main before the setup');
    r = I.resume('ch-01-a');
    assert.equal(r.status, 0, r.err);
    assert.equal(I.runs('ch-01-a').length, 3, 'and the next resume skips it again');
    // 1d: a ticket branch whose package-lock.json differs from main's gets no node_modules
    const tmp = path.join(F.base, 'branch-b');
    F.g(['worktree', 'add', '-q', '-b', 'ticket/ch-02-b', tmp, 'origin/main'], F.old);
    fs.writeFileSync(path.join(tmp, 'package-lock.json'), '{"lockfileVersion": 3, "changed": true}\n');
    F.g(['commit', '-qam', 'a new lockfile'], tmp);
    F.g(['push', '-q', 'origin', 'ticket/ch-02-b'], tmp);
    F.g(['worktree', 'remove', '--force', tmp], F.old);
    F.g(['branch', '-q', '-D', 'ticket/ch-02-b'], F.old);
    r = F.run(F.old, ['worker', 'ch-02-b'], I.role());
    assert.equal(r.status, 0, r.err);
    assert.match(fs.readFileSync(path.join(I.wt('ch-02-b'), 'package-lock.json'), 'utf8'), /changed/, 'the worktree continues from origin\'s branch');
    assert.equal(fs.existsSync(path.join(I.wt('ch-02-b'), 'node_modules')), false, 'no copy: the key differs');
    assert.deepEqual(I.runs('ch-02-b'), ['none']);
    assert.ok(fs.existsSync(path.join(I.wt('ch-02-b'), 'vendor/v.txt')), 'an entry whose key matches is still copied');
    // 1b: chore start, a new chore worktree
    r = F.run(F.old, ['chore', 'start', 'one'], I.role());
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(I.runs('chore-one'), ['had']);
    assert.ok(I.marker(I.wt('chore-one')), 'a chore worktree gets its marker too');
  } finally { I.finish(); }
});

test('2c-2f: a resume runs the setup again when a lockfile, the setup string or worktree_setup_always says so, or the last one failed', { skip: !hasTmux && 'no tmux' }, () => {
  const setup = (F, tag = '') => `${tag}echo "$(basename "$PWD")" >> ${F.base}/runs.log; exit "$(cat ${F.base}/code 2>/dev/null || echo 0)"`;
  const I = installFleet('installs-marker', (F) => ({ worktree_setup: setup(F) }));
  const { F } = I;
  const n = () => I.runs('ch-01-a').length;
  try {
    I.ticket('ch-01-a');
    const w = I.wt('ch-01-a');
    let r = F.run(F.old, ['worker', 'ch-01-a'], I.role());
    assert.equal(r.status, 0, r.err);
    assert.equal(n(), 1);
    assert.equal(fs.existsSync(path.join(w, 'node_modules')), false, 'no worktree_copy, no copy');
    assert.ok(I.marker(w));
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(n(), 1, 'a matching resume skips it');
    // 2c: a lockfile changed in the worktree (worktree_copy unset)
    fs.writeFileSync(path.join(w, 'package-lock.json'), '{"lockfileVersion": 3, "local": 1}\n');
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(n(), 2, 'a changed lockfile runs it again');
    // 2d: the setup string changed, committed on main
    I.settings((j) => { j.worktree_setup = setup(F, ': v2; '); }, 'a new setup');
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(n(), 3, 'a changed setup string runs it again');
    assert.equal(I.marker(w).setup, sha(setup(F, ': v2; ')));
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(n(), 3);
    // 2e: worktree_setup_always runs it on every resume
    I.settings((j) => { j.worktree_setup_always = true; }, 'always');
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(n(), 5, 'worktree_setup_always runs it each time');
    I.settings((j) => { j.worktree_setup_always = false; }, 'not always');
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(n(), 5);
    // 2f: a failing setup leaves no marker, and the next resume runs it again
    fs.writeFileSync(path.join(w, 'package-lock.json'), '{"lockfileVersion": 3, "local": 2}\n');
    fs.writeFileSync(path.join(F.base, 'code'), '1');
    r = I.resume('ch-01-a');
    assert.equal(r.status, 1, r.err);
    assert.match(r.err, /worktree_setup failed in /);
    assert.equal(n(), 6);
    assert.equal(I.marker(w), null, 'no marker after a failed setup');
    fs.writeFileSync(path.join(F.base, 'code'), '0');
    r = I.resume('ch-01-a');
    assert.equal(r.status, 0, r.err);
    assert.equal(n(), 7, 'the resume after a failure runs it again');
    assert.ok(I.marker(w));
  } finally { I.finish(); }
});

test('the copy refuses what it must: invalid entries, worktree_files, a symlinked main folder; a nested path; cut short at the deadline', () => {
  const ENTRIES = [
    { path: 'node_modules', key: 'package-lock.json' },
    { path: '/abs/folder', key: 'package-lock.json' },
    { path: '../up', key: 'package-lock.json' },
    { path: 'vendor', key: '../package-lock.json' },
    'not an object',
    { path: 'config', key: '.deps-key' },
    { path: 'build/deps', key: '.deps-key' },
  ];
  const I = installFleet('installs-refuse', (F) => ({ worktree_copy: ENTRIES, worktree_setup: `${RECORD(F)}; mkdir -p node_modules; echo worktree > node_modules/w.txt` }));
  const { F } = I;
  try {
    write(path.join(F.old, 'config/extra.txt'), 'gitignored, beside the worktree_files key\n');
    write(path.join(F.old, 'build/deps/d.txt'), 'deps\n');
    write(path.join(F.old, '.gitignore'), `${fs.readFileSync(path.join(F.old, '.gitignore'), 'utf8')}config/extra.txt\nbuild/\n`);
    F.g(['commit', '-qam', 'ignores'], F.old);
    F.g(['push', '-q', 'origin', 'main'], F.old);
    // invalid entries and a worktree_files overlap are warned and skipped; the rest copy, a nested
    // path whose parent the worktree lacks among them
    let r = F.run(F.old, ['chore', 'start', 'a'], I.role());
    assert.equal(r.status, 0, r.err);
    for (const bad of ['/abs/folder', '../up', '../package-lock.json', 'not an object']) assert.ok(r.err.includes(`worktree_copy: ${JSON.stringify(ENTRIES.find((e) => JSON.stringify(e).includes(JSON.stringify(bad))))} is not`), `${bad} warned: ${r.err}`);
    assert.match(r.err, /worktree_copy: config is or holds a worktree_files entry/);
    const wa = I.wt('chore-a');
    assert.equal(fs.existsSync(path.join(wa, 'config/extra.txt')), false, 'a worktree_files folder is never copied');
    assert.equal(fs.readFileSync(path.join(wa, 'config/dev.key'), 'utf8'), 'not a real key\n', 'worktree_files still copied');
    assert.equal(fs.readFileSync(path.join(wa, 'build/deps/d.txt'), 'utf8'), 'deps\n', 'a path whose parent the worktree lacks is copied');
    assert.deepEqual(I.runs('chore-a'), ['had']);
    assert.doesNotMatch(r.err, /could not copy/);
    // cut short at the deadline: a cp that never finishes is killed, its temp removed, no folder left
    const shims = fs.mkdtempSync(path.join(F.base, 'shims-'));
    fs.writeFileSync(path.join(shims, 'cp'), '#!/bin/sh\nfor a; do last="$a"; done; mkdir -p "$last"; exec sleep 63\n', { mode: 0o755 });
    const t0 = Date.now();
    r = F.run(F.old, ['chore', 'start', 'b'], I.role({ PATH: `${shims}${path.delimiter}${process.env.PATH}`, ...deadlineIn(2000) }));
    assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0} ms`);
    assert.match(r.err, /worktree_copy: could not copy node_modules .*cut short at the deadline/);
    assert.equal(r.status, 124, r.err);
    const wb = I.wt('chore-b');
    assert.equal(fs.existsSync(path.join(wb, 'node_modules/marker.txt')), false, 'no copy');
    assert.deepEqual(fs.readdirSync(wb).filter((e) => e.includes('.devteam-copy-')), [], 'no temp copy left');
    assert.deepEqual(pgrep('sleep 63'), [], 'the cut-short cp is gone');
    // main's folder a symlink (to a shared store): never copied, so the setup can't write through it
    const store = path.join(F.base, 'store');
    fs.renameSync(path.join(F.old, 'node_modules'), store);
    fs.symlinkSync(store, path.join(F.old, 'node_modules'));
    r = F.run(F.old, ['chore', 'start', 'c'], I.role());
    assert.equal(r.status, 0, r.err);
    assert.match(r.err, /worktree_copy: node_modules not copied: .* is a symlink/);
    const wc = I.wt('chore-c');
    assert.deepEqual(I.runs('chore-c'), ['none']);
    assert.equal(fs.lstatSync(path.join(wc, 'node_modules')).isSymbolicLink(), false);
    assert.equal(fs.existsSync(path.join(store, 'w.txt')), false, 'the setup wrote nothing into main\'s store');
    assert.deepEqual(fs.readdirSync(store), ['marker.txt']);
  } finally { I.finish(); }
});

test('M9, M14: the copy stays inside its checkouts: no sweep through a symlinked folder, no key that resolves outside', () => {
  const dead = spawnSync('true').pid;
  let elsewhere = null;
  const I = installFleet('installs-inside', (F) => {
    // a folder of the worktree that is a symlink to another tree, holding a stale temp copy's name
    elsewhere = path.join(F.base, 'elsewhere');
    write(path.join(elsewhere, `x.devteam-copy-${dead}`, 'half.txt'), 'not the worktree\'s\n');
    fs.symlinkSync(elsewhere, path.join(F.old, 'linked'));
    // a copy key that is a symlink to a file outside both checkouts, the same file from each
    write(path.join(F.base, 'outside-key.txt'), 'outside\n');
    fs.symlinkSync(path.join(F.base, 'outside-key.txt'), path.join(F.old, 'outkey'));
    write(path.join(F.old, 'outnm/o.txt'), 'main\'s\n');
    write(path.join(F.old, '.gitignore'), `${fs.readFileSync(path.join(F.old, '.gitignore'), 'utf8')}outnm/\n`);
    return { worktree_setup: RECORD(F), worktree_copy: [{ path: 'linked/x', key: 'package-lock.json' }, { path: 'outnm', key: 'outkey' }] };
  });
  const { F } = I;
  try {
    const r = F.run(F.old, ['chore', 'start', 'one'], I.role());
    assert.equal(r.status, 0, r.err);
    assert.ok(fs.existsSync(path.join(elsewhere, `x.devteam-copy-${dead}`, 'half.txt')), 'the sweep never reaches through a symlinked folder');
    assert.match(r.err, /worktree_copy: outnm not copied: its key outkey resolves outside the checkout/);
    assert.equal(fs.existsSync(path.join(I.wt('chore-one'), 'outnm')), false, 'no copy on a key outside the checkout');
  } finally { I.finish(); }
});

test('3a: a gate checkout (merge --chore\'s landing one) runs its setup inline: no slot, no runner, no copy', async () => {
  const I = installFleet('installs-gate', (F) => ({ worktree_copy: COPY, worktree_setup: `echo "$PWD $(ps -o pgid= -p $$ | tr -d ' ') $$ nm=$(ls node_modules 2>/dev/null | tr '\\n' ,) mk=$(test -f "$(git rev-parse --absolute-git-dir)/devteam-setup" && echo yes || echo no)" >> ${F.base}/gate.log` }));
  const { F } = I;
  const kids = [];
  try {
    // the chore branch, made with git and pushed with its PR text (chore start would take a slot)
    const slug = 'tidy';
    const c = path.join(F.old, '.worktrees', `chore-${slug}`);
    F.g(['worktree', 'add', '-q', '-b', `chore-${slug}`, c, 'origin/main'], F.old);
    write(path.join(c, 'docs/devteam/project/tidy.md'), '# Tidy\n');
    F.g(['add', '-A'], c);
    F.g(['commit', '-qm', slug], c);
    F.g(['push', '-q', 'origin', `chore-${slug}`], c);
    F.g(['worktree', 'remove', '--force', c], F.old);
    write(path.join(F.old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
    // the one slot held by a live process
    const p = spawn('sleep', ['30'], { stdio: 'ignore' });
    kids.push(p);
    hold(path.join(I.home, '.devteam', 'setup-slots'), 0, { pid: p.pid, start: startOf(p.pid) });
    const t0 = Date.now();
    const r = await runAsync(F, ['merge', '--chore', slug], I.role({ DEVTEAM_SETUP_SLOTS: '1' }));
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.ok(Date.now() - t0 < 60000, `merge took ${Date.now() - t0} ms`);
    assert.doesNotMatch(r.stderr, /waiting for a setup slot/);
    const lines = fs.readFileSync(path.join(F.base, 'gate.log'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(' '));
    const land = lines.filter(([wt]) => /[\\/]tmp-land-/.test(wt));
    assert.ok(land.length, `a setup ran in the landing checkout: ${JSON.stringify(lines)}`);
    for (const [wt, pgid, pid, nm, mk] of land) {
      assert.notEqual(pgid, pid, `${wt}: the setup's shell leads no group of its own (no runner)`);
      assert.equal(nm, 'nm=', `${wt}: no copied node_modules`);
      assert.equal(mk, 'mk=no', `${wt}: no marker`);
    }
  } finally { for (const p of kids) try { p.kill('SIGKILL'); } catch {} I.finish(); }
});

test('the docs say it', () => {
  const sup = fs.readFileSync('docs/devteam/process/supervisor.md', 'utf8');
  const sec = (from) => { const i = sup.indexOf(from); const j = sup.indexOf('\n## ', i + 1); return sup.slice(i, j < 0 ? undefined : j); };
  const s5 = sec('## 5. Scheduling and merging');
  for (const re of [/worktree_copy/, /npm install --prefer-offline/, /DEVTEAM_SETUP_SLOTS/, /lockfile/, /worktree_setup_always/, /gate checkouts?/]) assert.match(s5, re, `§5 ${re}`);
  assert.match(sec('## 11. Recovery'), /slot_held/);
  const readme = fs.readFileSync('README.md', 'utf8').split('\n').find((l) => l.includes('never inherited'));
  for (const re of [/worktree_copy/, /worktree_setup_always/, /chore worktrees/, /never (to )?gate checkouts/]) assert.match(readme, re, `README ${re}`);
});
