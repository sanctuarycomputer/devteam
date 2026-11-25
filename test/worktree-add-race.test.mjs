// Every git worktree add, and the fetches a start carries on past, over a sibling's half-made entry
// (kit-874; kit-857's chore start is in chore-worktree-race.test.mjs). A git on PATH empties a
// sibling's .git/worktrees/<name>/commondir just before the first call it is armed for, so the real
// git fails as it does when another worktree add stands between making that file and filling it; the
// shim fills it again a moment later, or never, or stands in for the call with a failure of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, hasTmux, write } from './lib/kit.mjs';
import { readyInHome, recordsFixture, SUP } from './lib/multirepo-home-fixture.mjs';

const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const tmux = { skip: hasTmux ? false : 'no tmux' };
const q = (s) => JSON.stringify(s);

// race.arm(match, how): the next git call whose arguments hold every string of match, in order; how:
// 'fill' (empty, filled 0.4 s after the call failed), 'stuck' (empty, left so), or { says } (that
// call, and each one after it that matches, prints says and exits 128). codes(): each matching call's
// exit. Disarmed and made whole by reset().
function race(F, cwd) {
  const sib = path.join(fs.mkdtempSync(path.join(F.base, 'sib-')), 'sibling');
  F.g(['worktree', 'add', '-q', '--detach', sib, 'HEAD'], cwd);
  const common = path.join(fs.realpathSync(cwd), '.git', 'worktrees', 'sibling', 'commondir');
  const bin = fs.mkdtempSync(path.join(F.base, 'shims-'));
  const at = (n) => path.join(bin, n);
  fs.copyFileSync(common, at('whole'));
  const shim = (match, how) => `#!/bin/sh
case " $* " in ${match.map((m) => `*${q(m)}`).join('')}*) ;; *) exec ${q(realGit)} "$@" ;; esac
${how.says ? `echo ${q(how.says)} >&2; echo 128 >> ${q(at('codes'))}; exit 128` : `first=; if [ ! -e ${q(at('met'))} ]; then first=1; : > ${q(at('met'))}; : > ${q(common)}; fi
${q(realGit)} "$@"
code=$?
echo "$code" >> ${q(at('codes'))}
${how === 'fill' ? `if [ -n "$first" ]; then (sleep 0.4; cp ${q(at('whole'))} ${q(common)}) </dev/null >/dev/null 2>&1 & fi` : ''}
exit $code`}
`;
  const reset = () => { for (const n of ['codes', 'met', 'git']) fs.rmSync(at(n), { force: true }); fs.copyFileSync(at('whole'), common); };
  return {
    env: { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    arm: (match, how) => { reset(); fs.writeFileSync(at('git'), shim(match, how), { mode: 0o755 }); },
    reset,
    codes: () => (fs.existsSync(at('codes')) ? fs.readFileSync(at('codes'), 'utf8').trim().split('\n') : []),
  };
}
const OTHER = 'fatal: a cause of its own';
const NOTE = /the entry sibling in \S+worktrees was still half made after 5 s \(its commondir is empty\)/;
const branchOf = (g, at) => g(['symbolic-ref', '--short', 'HEAD'], at);

// a subtest that leaves the entry whole and the shim gone, passed or not
const resetting = (t, R) => ({ test: (name, fn) => t.test(name, async () => { try { await fn(); } finally { R.reset(); } }) });

// One add: outlived once filled; given up on, named, at the limit; any other failure at once, as it
// was worded. go(n) runs the command for the nth time and answers { status, out, err }.
async function addCase(t0, R, { name, match, go, made, says, note = NOTE, only = false }) {
  const t = resetting(t0, R);
  await t.test(`${name}: waits for the entry`, () => {
    R.arm(match, 'fill');
    const r = go(1);
    assert.equal(r.status, 0, `${name} outlives the half-made entry: ${r.err}`);
    assert.deepEqual(R.codes(), ['128', '0'], `${name} tried again, once`);
    made(r, 1);
  });
  if (only) return;
  await t.test(`${name}: any other failure, at once, in its words`, () => {
    R.arm(match, { says: OTHER });
    const r = go(2);
    assert.deepEqual(R.codes(), ['128'], `${name}: one try`);
    assert.match(`${r.out}\n${r.err}`, says, `${name}: the words it has today, and no more`);
  });
  await t.test(`${name}: left half made, names the entry at the limit`, () => {
    R.arm(match, 'stuck');
    const t0 = Date.now();
    const r = go(3);
    const ms = Date.now() - t0;
    assert.match(`${r.out}\n${r.err}`, note, `${name}: the entry and the limit are named`);
    assert.ok(ms >= 5000 && ms < 30000, `${name}: gave up after ${ms} ms`);
  });
}

test('home: every other add outlives a sibling\'s half-made entry', async (t) => {
  const F = fleetFixture('wt-rest-home');
  const { old, g, ok, run } = F;
  try {
    const R = race(F, old);
    const sha = g(['rev-parse', 'main'], old);
    const wt = (n) => path.join(old, '.worktrees', n);
    const ticket = (id) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`ch/${id}/**`], done_when: ['the tidy check passes in CI'] })], SUP);
    for (const id of ['ch-01-a', 'ch-02-b', 'ch-03-c', 'ch-04-d']) ticket(id);
    const G = ok(old, ['goal', 'add', '--title', 'G', '--outcome', 'o', '--measure', 'm', '--target', '0', '--unit', 'u', '--direction', 'down', '--source', 'repo', '--check', 'echo 7', '--non-goals', 'none', '--preconditions', 'a'], SUP).trim();
    const ADD = 'git -c core\\.useReplaceRefs=false worktree add --quiet --detach \\S+ [0-9a-f]{40} failed: fatal: a cause of its own\\s*$';

    await addCase(t, R, { name: 'detachedWorktree', match: [' worktree add ', 'tmp-reading-'], go: () => run(old, ['goal', 'reading', G, '--run'], R.env), made: (r) => assert.match(r.out, /^recorded 7 for /), says: new RegExp(`devteam: ${ADD}`) });
    await addCase(t, R, { name: 'review-worktree', match: [' worktree add ', 'review-ch-01'], go: (n) => run(old, ['review-worktree', 'ch-01-a', sha, '--name', `n${n}`], R.env), made: (r) => assert.equal(g(['rev-parse', 'HEAD'], r.out.split('\n')[0]), sha), says: new RegExp(`devteam: ${ADD}`) });
    write(path.join(old, 'docs/devteam/project/recurring.json'), `${JSON.stringify({ nr: { kind: 'check', title: 'M', what: 'w', every: '1d', run: 'echo here' } }, null, 2)}\n`);
    await addCase(t, R, { name: 'a recurring check', match: [' worktree add ', 'tmp-recurring-'], go: () => run(old, ['recurring', 'run', 'nr', '--draft'], R.env), made: (r) => assert.match(r.out, /^excerpt: .*\bhere\b/m), says: /the checkout could not be made: fatal: a cause of its own\s*$/m, note: /sibling\/commondir: \w+; still half made at the limit\s*$/m });
    await addCase(t, R, { name: 'the responder', match: [' worktree add ', '.worktrees/responder'], go: (n) => { if (n > 1) { run(old, ['responder', '--stop'], SUP); if (fs.existsSync(wt('responder'))) g(['worktree', 'remove', '--force', wt('responder')], old); } return run(old, ['responder'], R.env); }, made: () => assert.equal(g(['rev-parse', 'HEAD'], wt('responder')), sha), says: /could not add it at [0-9a-f]{8}: fatal: a cause of its own\s*$/ });
    await addCase(t, R, { name: 'a worker', match: [' worktree add ', '.worktrees/ch-0'], go: (n) => run(old, ['worker', ['', 'ch-02-b', 'ch-03-c', 'ch-04-d'][n]], R.env), made: () => assert.equal(branchOf(g, wt('ch-02-b')), 'ticket/ch-02-b'), says: /git worktree add ticket\/ch-03-c failed: a cause of its own; nothing was started\s*$/ });
  } finally { F.done(); }
});

test('several repos: both review checkouts, a worker\'s and each form of the records add outlive it', tmux, async (t) => {
  const F = recordsFixture('wt-rest-records');
  const { old, g, ticket } = F;
  try {
    const done = readyInHome(F, 'console-14-d');
    const home = race(F, old), link = race(F, F.console);
    const rec = (id) => path.join(old, '.worktrees', `records-${id}`);
    const review = (R) => (n) => F.run(old, ['review-worktree', 'console-14-d', done.code, '--name', `${R === home ? 'h' : 'l'}${n}`], R.env);
    const ADD = /devteam: git -c core\.useReplaceRefs=false worktree add --quiet --detach \S+ [0-9a-f]{40} failed: fatal: a cause of its own\s*$/;
    await addCase(t, link, { name: 'review-worktree in a link', match: [' worktree add ', 'review-console-14', done.code], go: review(link), made: (r) => assert.equal(g(['rev-parse', 'HEAD'], r.out.split('\n')[0]), done.code), says: ADD });
    await addCase(t, home, { name: 'review-worktree\'s records checkout', match: [' worktree add ', '-records '], go: review(home), made: (r) => assert.match(r.out, new RegExp(`^records: \\S+ \\(${done.head}\\)$`, 'm')), says: ADD });
    for (let n = 1; n <= 5; n++) ticket(`console-2${n}-a`);
    const worker = (R, id) => F.run(old, ['worker', `console-2${id}-a`], R.env);
    const main = g(['rev-parse', 'origin/main'], old);
    await addCase(t, link, { name: 'a worker in a link', match: [' worktree add ', '.worktrees/console-25'], go: () => worker(link, 5), made: () => assert.equal(g(['symbolic-ref', '--short', 'HEAD'], path.join(old, '.worktrees', 'console-25-a')), 'ticket/console-25-a'), says: / /, only: true });
    const records = { match: [' worktree add ', '/records-'], says: /devteam: git -c core\.useReplaceRefs=false worktree add --quiet -b ticket\/console-24-a \S+ origin\/main failed: fatal: a cause of its own\s*$/ };
    g(['branch', 'ticket/console-21-a', main], old);
    await addCase(t, home, { ...records, name: 'records on a local branch', go: () => worker(home, 1), made: () => assert.equal(g(['symbolic-ref', '--short', 'HEAD'], rec('console-21-a')), 'ticket/console-21-a'), only: true });
    g(['push', '-q', 'origin', `${main}:refs/heads/ticket/console-22-a`], old);
    await addCase(t, home, { ...records, name: 'records on origin\'s branch', go: () => worker(home, 2), made: () => { assert.equal(g(['symbolic-ref', '--short', 'HEAD'], rec('console-22-a')), 'ticket/console-22-a'); assert.equal(g(['config', 'branch.ticket/console-22-a.merge'], old), 'refs/heads/ticket/console-22-a', 'its upstream is origin\'s branch'); }, only: true });
    await addCase(t, home, { ...records, name: 'records on a new branch', go: (n) => worker(home, n === 1 ? 3 : 4), made: () => assert.equal(g(['rev-parse', 'ticket/console-23-a'], old), main) });
  } finally { F.done(); }
});

// A commit on a branch of the fixture's origin that the checkout doesn't have, made in origin itself.
function ahead(F, branch, from = 'main') {
  const at = `--git-dir=${F.org}`;
  const sha = F.g([at, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit-tree', `${from}^{tree}`, '-p', from, '-m', 'ahead'], F.old);
  F.g([at, 'update-ref', `refs/heads/${branch}`, sha], F.old);
  return sha;
}
const FETCH_HALF = '1';

test('a chore start\'s fetches outlive it', async (t) => {
  const F = fleetFixture('wt-rest-fetch');
  const { old, g } = F;
  try {
    const R = race(F, old), T = resetting(t, R);
    const wt = (n) => path.join(old, '.worktrees', `chore-${n}`);
    const start = (slug) => F.run(old, ['chore', 'start', slug], R.env);
    const head = (slug) => g(['rev-parse', 'HEAD'], wt(slug));
    const MAIN = [' fetch --quiet origin main '];
    await T.test('main\'s (choreWorktree)', () => {
      const sha = ahead(F, 'main');
      R.arm(MAIN, 'fill');
      const r = start('a');
      assert.equal(r.status, 0, r.err);
      assert.deepEqual(R.codes(), [FETCH_HALF, '0'], 'fetched again');
      assert.equal(head('a'), sha, 'the chore starts from origin\'s main');
    });
    await T.test('the chore\'s own branch (choreBranch)', () => {
      const sha = ahead(F, 'chore-b');
      R.arm([' fetch ', 'refs/heads/chore-b:'], 'fill');
      const r = start('b');
      assert.equal(r.status, 0, r.err);
      assert.doesNotMatch(r.err, /couldn't fetch/, 'the branch was fetched again');
      assert.equal(head('b'), sha, 'the chore carries on from origin\'s branch');
    });
    await T.test('any other failure is passed over at once, as today', () => {
      const was = g(['rev-parse', 'origin/main'], old);
      ahead(F, 'main');
      R.arm(MAIN, { says: OTHER });
      const r = start('c');
      assert.equal(r.status, 0, r.err);
      assert.deepEqual(R.codes(), ['128'], 'one try');
      assert.equal(head('c'), was, 'from main as last fetched');
      R.arm([' fetch ', 'refs/heads/chore-d:'], { says: OTHER });
      ahead(F, 'chore-d');
      const d = start('d');
      assert.equal(d.status, 0, d.err);
      assert.deepEqual(R.codes(), ['128'], 'one try of its own branch\'s');
      assert.match(d.err, /couldn't fetch chore-d from origin \(fatal: a cause of its own\); reading the refs as they are/);
    });
    await T.test('left half made: the fetch ends, and the add names the entry', () => {
      R.arm(MAIN, 'stuck');
      const t0 = Date.now();
      const r = start('e');
      const ms = Date.now() - t0;
      assert.equal(r.status, 1);
      assert.match(r.err, NOTE);
      assert.ok(ms >= 10000 && ms < 40000, `gave up after ${ms} ms`);
    });
  } finally { F.done(); }
});

test('a repo measure\'s fetch outlives it: the reading is of origin\'s main (runMeasureCheck)', async (t) => {
  const F = fleetFixture('wt-rest-measure');
  const { old, ok } = F;
  try {
    const R = race(F, old), T = resetting(t, R);
    const G = ok(old, ['goal', 'add', '--title', 'C', '--outcome', 'o', '--measure', 'commits', '--target', '0', '--unit', 'commits', '--direction', 'down', '--source', 'repo', '--check', 'git rev-list --count HEAD', '--non-goals', 'none', '--preconditions', 'a'], SUP).trim();
    const count = () => F.g([`--git-dir=${F.org}`, 'rev-list', '--count', 'main'], old);
    const FETCH = [' fetch --quiet origin '];
    await T.test('waits for the entry', () => {
      ahead(F, 'main');
      R.arm(FETCH, 'fill');
      const r = F.run(old, ['goal', 'reading', G, '--run'], R.env);
      assert.equal(r.status, 0, r.err);
      assert.deepEqual(R.codes(), [FETCH_HALF, '0'], 'fetched again');
      assert.match(r.out, new RegExp(`^recorded ${count()} for `), 'read on origin\'s main');
    });
    await T.test('any other failure is passed over at once, as today', () => {
      R.arm(FETCH, { says: OTHER });
      const r = F.run(old, ['goal', 'reading', G, '--run'], R.env);
      assert.equal(r.status, 0, r.err);
      assert.deepEqual(R.codes(), ['128'], 'one try');
    });
  } finally { F.done(); }
});

test('the records checkout\'s fetches outlive it', tmux, async (t) => {
  const F = recordsFixture('wt-rest-records-fetch');
  const { old, g, ticket } = F;
  try {
    const R = race(F, old), T = resetting(t, R);
    for (let n = 1; n <= 4; n++) ticket(`console-3${n}-a`);
    const worker = (n) => F.run(old, ['worker', `console-3${n}-a`], R.env);
    const tip = (n) => g(['rev-parse', 'HEAD'], path.join(old, '.worktrees', `records-console-3${n}-a`));
    await T.test('home\'s main', () => {
      R.arm([' fetch --quiet origin main '], 'fill');
      const r = worker(1);
      assert.equal(r.status, 0, r.err);
      assert.deepEqual(R.codes(), [FETCH_HALF, '0'], 'fetched again');
    });
    await T.test('home\'s ticket branch', () => {
      const sha = ahead(F, 'ticket/console-32-a');
      R.arm([' fetch --quiet origin ', 'refs/heads/ticket/console-32-a:'], 'fill');
      const r = worker(2);
      assert.equal(r.status, 0, r.err);
      assert.equal(tip(2), sha, 'the records start from origin\'s ticket branch');
    });
    await T.test('any other failure is passed over at once, as today', () => {
      R.arm([' fetch --quiet origin ', 'refs/heads/ticket/console-33-a:'], { says: OTHER });
      const r = worker(3);
      assert.equal(r.status, 0, r.err);
      assert.deepEqual(R.codes(), ['128'], 'one try of the ticket branch\'s');
      R.arm([' fetch --quiet origin main '], { says: OTHER });
      const m = worker(4);
      assert.equal(m.status, 0, m.err);
      assert.deepEqual(R.codes(), ['128'], 'one try of main\'s');
    });
  } finally { F.done(); }
});
