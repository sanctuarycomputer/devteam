// merge records its act when GitHub merged a PR although gh pr merge errored (kit-782): after a
// gh pr merge that exits non-zero, merge reads the PR's state from GitHub; MERGED at the gated
// head, for a PR open when merge began, is a landing (the act is written, records land as for a
// clean merge), read again while GitHub still says OPEN (three reads, ~2s apart); anything else is
// refused as before. Each test is a fixture with bare origins and a gh first on PATH whose pr merge
// can really merge into the bare origin (as GitHub would) and then exit 1. Every gh call after the
// gates has a timeout (kit-787): a gh pr merge or a state read that never answers is killed at its
// bound and read as failed, so merge refuses as before instead of waiting on it; and a PR GitHub
// reports CLOSED at the gated head is refused, never adopted. Run with TMUX unset: no fixture here
// starts or stops a tmux server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { multiFixture, write, json, review } from './lib/kit.mjs';
import { readyInHome, recordsFixture } from './lib/multirepo-home-fixture.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const VERIF = '| Done-when | Command | Result |\n|---|---|---|\n| s | t | pass |\n';
const REFUSED = /gh pr merge refused \(did the head move\?\); verify from the start/;
// A gh that never answers hangs this long, far past the bound merge is given here (GH_BOUND, through
// DEVTEAM_GH_TIMEOUT_MS); a merge that waits on it can't finish inside WITHIN, so an unbounded call
// turns the check red at about HANG_MS rather than hanging the suite. Five such reds wait ~10 minutes, so
// on CI a regressed bound shows as the 300 s watchdog stopping this file, not as named not-ok lines:
// run the file here to see which check failed.
const HANG_MS = 120000;
const GH_BOUND = { DEVTEAM_GH_TIMEOUT_MS: '5000' };
const WITHIN = 60000;
const timed = (fn) => { const t0 = Date.now(); const r = fn(); return { ...r, ms: Date.now() - t0 }; };

// A gh first on PATH. pr view answers the file pr.json; pr list answers no merged PR. pr merge runs
// merge.sh when it exists (the merge GitHub makes: into the bare origin), marks the PR merged-at-gh,
// prints an error and exits 1, as a gh that errored. Each pr view after that logs its working
// directory to views.log and its time in milliseconds to times.log and, once `lag` such reads have
// answered as before, copies after.json over pr.json (what GitHub says once it has finished); with
// fail-views-after, every pr view after it fails. With hangs-merge, pr merge marks the PR
// merged-at-gh and then never answers (it exits 1 after HANG_MS, far past the bound merge is given);
// with hangs-views-after, so does each pr view after it. Each hang is an exec of node, so the kill at
// merge's timeout reaches the process that hangs; it ignores SIGTERM, so only merge's SIGKILL ends it.
function ghStandIn(F, pr) {
  const dir = path.join(F.base, 'gh-stand-in');
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'gh.log');
  const views = path.join(dir, 'views.log');
  const times = path.join(dir, 'times.log');
  const prFile = path.join(dir, 'pr.json');
  const after = path.join(dir, 'after.json');
  const lag = path.join(dir, 'lag');
  const mergedAt = path.join(dir, 'merged-at-gh');
  const failAfter = path.join(dir, 'fail-views-after');
  const mergeSh = path.join(dir, 'merge.sh');
  const hangsMerge = path.join(dir, 'hangs-merge');
  const hangsViews = path.join(dir, 'hangs-views-after');
  const hang = `exec "${process.execPath}" -e "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(1), ${HANG_MS})"`;
  write(prFile, JSON.stringify(pr));
  write(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `echo "$@" >> "${log}"`,
    'case "$1 $2" in',
    '  "pr view")',
    `    if [ -f "${mergedAt}" ]; then`,
    `      pwd >> "${views}"`,
    `      "${process.execPath}" -p "Date.now()" >> "${times}"`,
    `      [ -f "${failAfter}" ] && exit 1`,
    `      [ -f "${hangsViews}" ] && ${hang}`,
    `      n=$(cat "${lag}" 2>/dev/null || echo 0)`,
    `      if [ "$n" -gt 0 ]; then echo $((n - 1)) > "${lag}"; elif [ -f "${after}" ]; then cp "${after}" "${prFile}"; fi`,
    '    fi',
    `    exec cat "${prFile}" ;;`,
    `  "pr list") echo '[]'; exit 0 ;;`,
    '  "pr merge")',
    `    if [ -f "${mergeSh}" ]; then sh "${mergeSh}" >/dev/null 2>&1 || exit 2; fi`,
    `    touch "${mergedAt}"`,
    `    [ -f "${hangsMerge}" ] && ${hang}`,
    '    echo "GraphQL: something went wrong" >&2; exit 1 ;;',
    'esac',
    'exit 1',
    '',
  ].join('\n'));
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
  return {
    env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    calls,
    prMerges: () => calls().filter((c) => c.startsWith('pr merge ')),
    // the working directory of each pr view after the merge (the state reads)
    stateReads: () => (fs.existsSync(views) ? fs.readFileSync(views, 'utf8').split('\n').filter(Boolean) : []),
    // when each of those reads ran, in milliseconds
    readTimes: () => (fs.existsSync(times) ? fs.readFileSync(times, 'utf8').split('\n').filter(Boolean).map(Number) : []),
    // after pr merge, GitHub answers this PR, once `lagReads` reads have answered as before
    answersAfter: (p, lagReads = 0) => { write(after, JSON.stringify(p)); write(lag, `${lagReads}\n`); },
    // after pr merge, every pr view fails (GitHub can't be read)
    failsAfter: () => write(failAfter, ''),
    // pr merge never answers (GitHub took the call and went quiet)
    hangsMerge: () => write(hangsMerge, ''),
    // after pr merge, every pr view never answers
    hangsAfter: () => write(hangsViews, ''),
    // pr merge really merges origin's `from` onto origin's `onto`, in a clone of `bare` of its own
    merges: (bare, onto, from) => {
      const clone = path.join(dir, 'github');
      F.g(['clone', '-q', bare, clone], F.base);
      const g = `git -C '${clone}' -c user.email=gh@example.test -c user.name=github`;
      write(mergeSh, `set -e\n${g} fetch -q origin ${onto} ${from}\n${g} checkout -q -B ${onto} origin/${onto}\n${g} merge -q --no-ff -m 'Merge pull request from ${from}' origin/${from}\n${g} push -q origin HEAD:refs/heads/${onto}\n`);
    },
  };
}
const tipOf = (F, co, branch) => { F.g(['fetch', '-q', 'origin'], co); return F.g(['rev-parse', `origin/${branch}`], co); };
const landedOn = (F, co, sha, branch) => { F.g(['fetch', '-q', 'origin'], co); try { F.g(['merge-base', '--is-ancestor', sha, `origin/${branch}`], co); return true; } catch { return false; } };
const acts = (F) => json(F.okIn(F.old, ['log', '--type', 'act', '--json']));
const mergeActs = (F, id) => acts(F).filter((a) => a.class === 'merge-word' && (a.refs ?? []).includes(id));
const recordsActs = (F, id) => acts(F).filter((a) => a.class === 'merge-word' && String(a.what).startsWith(`merged home's ticket/${id} at `));

// console on forge github: a ticket ready to merge, records with its code, and an open, clean PR #7
// at its head as the stand-in's pr view answers it.
function readyOnGithub(F, id, prExtra = {}) {
  const links = json(F.okIn(F.old, ['settings'])).links;
  F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, forge: 'github', gates: { test: 'true' } } } });
  F.ticket(id, { touches: ['src/**'] });
  const w = path.join(F.old, '.worktrees', id);
  F.g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/trunk'], F.console);
  const tdir = path.join(w, `docs/devteam/project/tickets/${id}`);
  write(path.join(tdir, 'spec.md'), '# spec\n');
  write(path.join(tdir, 'plan.md'), '# plan\n\n## TL;DR\n\n- x\n');
  write(path.join(tdir, 'verification.md'), VERIF);
  write(path.join(w, 'src/main.js'), 'changed\n');
  F.g(['add', '-A'], w); F.g(['commit', '-qm', `${id}: work`], w);
  write(path.join(tdir, 'reviews/final-1.md'), review('reviewer-b', F.g(['rev-parse', 'HEAD'], w)));
  F.g(['add', '-A'], w); F.g(['commit', '-qm', 'review'], w); F.g(['push', '-q', 'origin', `ticket/${id}`], w);
  F.okIn(F.old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'ok'], SUP);
  F.okIn(F.old, ['act', '--class', 'approve-plan', '--refs', id, '--', 'ok'], SUP);
  const sha = F.g(['rev-parse', 'HEAD'], w);
  const pr = { number: 7, headRefOid: sha, title: `${id}: work`, body: '## One-way doors\n\nNone.\n', isDraft: false, mergeStateStatus: 'CLEAN', state: 'OPEN', url: 'https://example.test/pr/7', statusCheckRollup: [], ...prExtra };
  return { sha, pr, gh: ghStandIn(F, pr) };
}

test('C1 code, forge github: gh pr merge merges the PR on GitHub, then exits non-zero; merge reads it MERGED at the head and writes the merge act', () => {
  const F = multiFixture('kit782-code-merged');
  const id = 'console-01-a';
  try {
    const { sha, pr, gh } = readyOnGithub(F, id);
    gh.merges(F.consoleOrigin, 'trunk', `ticket/${id}`);
    gh.answersAfter({ ...pr, state: 'MERGED' });
    const r = F.runIn(F.old, ['merge', id], SUP, gh.env);
    assert.equal(landedOn(F, F.console, sha, 'trunk'), true, 'GitHub merged the head (the stand-in did)');
    assert.equal(r.status, 0, `merge exits 0 when GitHub merged the PR: ${r.err}`);
    assert.match(r.out, new RegExp(`merged ticket/${id} at ${sha.slice(0, 12)} in console`));
    assert.match(r.out, new RegExp(`gh pr merge of #7 exited non-zero, but GitHub has #7 merged at ${sha.slice(0, 12)}: landed`));
    assert.equal(gh.prMerges().length, 1, 'one gh pr merge, never a second');
    assert.ok(gh.calls().some((c) => /^pr view 7 --json .*state/.test(c) && /headRefOid/.test(c)), 'it asked GitHub for #7\'s state and head after the error');
    assert.equal(gh.stateReads().length, 1, 'one state read: MERGED on the first');
    assert.equal(fs.realpathSync(gh.stateReads()[0]), fs.realpathSync(F.console), 'the state read asks console\'s repo (run in its checkout), as gh pr merge did');
    const a = mergeActs(F, id);
    assert.equal(a.length, 1, 'one merge act');
    assert.ok(a[0].what.startsWith(`merged ticket/${id} at ${sha}`), a[0].what);
    assert.equal(a[0].repo, 'console');
  } finally { F.done(); }
});

test('C2 code, forge github: gh pr merge exits non-zero and GitHub still has the PR open: refused as today, no act', () => {
  const F = multiFixture('kit782-code-open');
  const id = 'console-01-a';
  try {
    const { sha, gh } = readyOnGithub(F, id);
    const trunk = tipOf(F, F.console, 'trunk');
    const r = F.runIn(F.old, ['merge', id], SUP, gh.env);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, REFUSED);
    assert.equal(gh.stateReads().length, 3, 'read while OPEN, three times at most, then refused');
    assert.equal(tipOf(F, F.console, 'trunk'), trunk, 'nothing landed');
    assert.equal(landedOn(F, F.console, sha, 'trunk'), false);
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
  } finally { F.done(); }
});

test('C3 code, forge github: gh pr merge exits non-zero and GitHub has the PR merged at another head: refused, no act', () => {
  const F = multiFixture('kit782-code-other-head');
  const id = 'console-01-a';
  try {
    const { pr, gh } = readyOnGithub(F, id);
    gh.answersAfter({ ...pr, state: 'MERGED', headRefOid: 'f'.repeat(40) });
    const r = F.runIn(F.old, ['merge', id], SUP, gh.env);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, REFUSED);
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
  } finally { F.done(); }
});

test('C4 code, forge github: gh pr merge exits non-zero and the state read fails too: refused, no act', () => {
  const F = multiFixture('kit782-code-no-read');
  const id = 'console-01-a';
  try {
    const { gh } = readyOnGithub(F, id);
    gh.failsAfter();
    const r = F.runIn(F.old, ['merge', id], SUP, gh.env);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, REFUSED);
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
  } finally { F.done(); }
});

test('C5 code, forge github: the PR was already merged (squashed on GitHub by someone else) before merge ran; gh pr merge exits non-zero: refused, never adopted, no act', () => {
  const F = multiFixture('kit782-code-merged-before');
  const id = 'console-01-a';
  try {
    const { pr, gh } = readyOnGithub(F, id, { state: 'MERGED' });
    const r = F.runIn(F.old, ['merge', id], SUP, gh.env);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, REFUSED);
    assert.equal(pr.state, 'MERGED');
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
  } finally { F.done(); }
});

test('C6 code, forge github: gh pr merge exits non-zero and GitHub still says OPEN twice, then MERGED at the head: merge reads again and writes the act', () => {
  const F = multiFixture('kit782-code-lag');
  const id = 'console-01-a';
  try {
    const { sha, pr, gh } = readyOnGithub(F, id);
    gh.merges(F.consoleOrigin, 'trunk', `ticket/${id}`);
    gh.answersAfter({ ...pr, state: 'MERGED' }, 2);
    const r = F.runIn(F.old, ['merge', id], SUP, gh.env);
    assert.equal(r.status, 0, `merge exits 0 once GitHub says MERGED on the third read: ${r.err}`);
    assert.match(r.out, new RegExp(`gh pr merge of #7 exited non-zero, but GitHub has #7 merged at ${sha.slice(0, 12)}: landed`));
    assert.equal(gh.stateReads().length, 3, 'three reads');
    const t = gh.readTimes();
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 1500, `reads ${i} and ${i + 1} are ${t[i] - t[i - 1]} ms apart, not ~2s`);
    assert.equal(mergeActs(F, id).length, 1, 'one merge act');
  } finally { F.done(); }
});

test('C7 code, forge github: gh pr merge never answers; merge kills it at its bound, reads the state (still OPEN) and refuses as today, no act', { timeout: 300000 }, () => {
  const F = multiFixture('kit787-code-merge-hangs');
  const id = 'console-01-a';
  try {
    const { sha, gh } = readyOnGithub(F, id);
    gh.hangsMerge();
    const trunk = tipOf(F, F.console, 'trunk');
    const r = timed(() => F.runIn(F.old, ['merge', id], SUP, { ...gh.env, ...GH_BOUND }));
    assert.ok(r.ms < WITHIN, `merge refused inside the bound, not after the hung gh pr merge returned (${r.ms} ms)`);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, REFUSED);
    assert.equal(gh.prMerges().length, 1, 'one gh pr merge, never a second');
    assert.equal(gh.stateReads().length, 3, 'a killed gh pr merge reads as not merged: the state is read, three times while OPEN');
    assert.equal(tipOf(F, F.console, 'trunk'), trunk, 'nothing landed');
    assert.equal(landedOn(F, F.console, sha, 'trunk'), false);
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
  } finally { F.done(); }
});

test('C8 code, forge github: gh pr merge exits non-zero and the state read never answers; merge kills it at its bound and refuses as today, no act', { timeout: 300000 }, () => {
  const F = multiFixture('kit787-code-read-hangs');
  const id = 'console-01-a';
  try {
    const { gh } = readyOnGithub(F, id);
    gh.hangsAfter();
    const r = timed(() => F.runIn(F.old, ['merge', id], SUP, { ...gh.env, ...GH_BOUND }));
    assert.ok(r.ms < WITHIN, `merge refused inside the bound, not after the hung state read returned (${r.ms} ms)`);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, REFUSED);
    assert.equal(gh.stateReads().length, 1, 'a killed read is no answer: one read, then refused');
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
  } finally { F.done(); }
});

test('C10 code, forge github: gh pr merge merges on GitHub, then never answers; merge kills it at its bound, reads MERGED at the head and writes the act', { timeout: 300000 }, () => {
  const F = multiFixture('kit787-code-killed-merged');
  const id = 'console-01-a';
  try {
    const { sha, pr, gh } = readyOnGithub(F, id);
    gh.merges(F.consoleOrigin, 'trunk', `ticket/${id}`);
    gh.hangsMerge();
    gh.answersAfter({ ...pr, state: 'MERGED' });
    const r = timed(() => F.runIn(F.old, ['merge', id], SUP, { ...gh.env, ...GH_BOUND }));
    assert.equal(landedOn(F, F.console, sha, 'trunk'), true, 'GitHub merged the head (the stand-in did)');
    assert.equal(r.status, 0, `a killed gh pr merge reads its state like any error, and MERGED at the head is adopted: ${r.err}`);
    assert.ok(r.ms < WITHIN, `adopted inside the bound (${r.ms} ms)`);
    assert.match(r.out, new RegExp(`gh pr merge of #7 exited non-zero, but GitHub has #7 merged at ${sha.slice(0, 12)}: landed`));
    assert.equal(gh.stateReads().length, 1, 'one state read: MERGED on the first');
    assert.equal(mergeActs(F, id).length, 1, 'one merge act');
  } finally { F.done(); }
});

test('C9 code, forge github: gh pr merge exits non-zero and GitHub has the PR CLOSED at the gated head: refused, never adopted, no act', () => {
  const F = multiFixture('kit787-code-closed');
  const id = 'console-01-a';
  try {
    const { sha, pr, gh } = readyOnGithub(F, id);
    gh.answersAfter({ ...pr, state: 'CLOSED' });
    const r = F.runIn(F.old, ['merge', id], SUP, gh.env);
    assert.equal(pr.headRefOid, sha, 'CLOSED at the very head the checks judged');
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, REFUSED);
    assert.equal(gh.stateReads().length, 1, 'CLOSED is an answer: one read');
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
  } finally { F.done(); }
});

// Records in home with home on forge github and console on forge git: the stand-in answers home's
// records PR #9 (open, clean, at the records head) and its pr merge can really merge home's
// ticket/<id> into home's main.
function recordsOnGithub(F, id) {
  const links = json(F.okIn(F.old, ['settings'])).links;
  F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { forge: 'github', links: { ...links, console: { ...links.console, records: 'home', forge: 'git', gates: { test: 'true' } } } });
  const r0 = readyInHome(F, id);
  const pr = { number: 9, headRefOid: r0.head, isDraft: false, mergeStateStatus: 'CLEAN', state: 'OPEN', statusCheckRollup: [] };
  return { r0, pr, gh: ghStandIn(F, pr) };
}

test('R1 records in home, home forge github: the records PR\'s gh pr merge merges it, then exits non-zero; merge reads it MERGED at the pinned records, writes their act and lands the code', () => {
  const F = recordsFixture('kit782-records-merged');
  const id = 'console-01-a';
  try {
    const homeOrigin = F.g(['config', '--get', 'remote.origin.url'], F.old);
    const { r0, pr, gh } = recordsOnGithub(F, id);
    gh.merges(homeOrigin, 'main', `ticket/${id}`);
    gh.answersAfter({ ...pr, state: 'MERGED' });
    const r = F.runIn(F.old, ['merge', id], SUP, gh.env);
    assert.equal(landedOn(F, F.old, r0.head, 'main'), true, 'GitHub merged the records (the stand-in did)');
    assert.equal(r.status, 0, `merge exits 0 when GitHub merged the records PR: ${r.err}`);
    assert.match(r.out, new RegExp(`gh pr merge of home's records PR #9 exited non-zero, but GitHub has #9 merged at ${r0.head.slice(0, 12)}: landed`));
    assert.match(r.out, new RegExp(`landed the records of ${id} at ${r0.head.slice(0, 12)} in home`));
    assert.match(r.out, new RegExp(`merged ticket/${id} at ${r0.code.slice(0, 12)} in console`));
    assert.equal(gh.prMerges().length, 1, 'one gh pr merge');
    assert.equal(gh.stateReads().length, 1, 'one state read: MERGED on the first');
    const ra = recordsActs(F, id);
    assert.equal(ra.length, 1, 'the records act');
    assert.ok(ra[0].what.startsWith(`merged home's ticket/${id} at ${r0.head}: the records of ${id}`), ra[0].what);
    assert.equal(mergeActs(F, id).length, 1, 'the code act');
    assert.equal(landedOn(F, F.console, r0.code, 'trunk'), true, 'the code landed');
  } finally { F.done(); }
});

test('R2 records in home, home forge github: the records PR\'s gh pr merge exits non-zero and GitHub has it open: refused as today, nothing lands', () => {
  const F = recordsFixture('kit782-records-open');
  const id = 'console-01-a';
  try {
    const { r0, gh } = recordsOnGithub(F, id);
    const trunk = tipOf(F, F.console, 'trunk');
    const r = F.runIn(F.old, ['merge', id], SUP, gh.env);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, new RegExp(`the records of ${id} did not land in home \\(gh pr merge of home's records PR #9 refused \\(did its head move\\?\\)\\); nothing landed: verify from the start`));
    assert.equal(gh.stateReads().length, 3, 'read while OPEN, three times at most, then refused');
    assert.equal(landedOn(F, F.old, r0.head, 'main'), false);
    assert.deepEqual(recordsActs(F, id), [], 'no records act');
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
    assert.equal(tipOf(F, F.console, 'trunk'), trunk, 'the code did not land');
  } finally { F.done(); }
});

test('R3 records in home, home forge github: the records PR\'s gh pr merge exits non-zero and GitHub has it merged at another head: refused, nothing lands', () => {
  const F = recordsFixture('kit782-records-other-head');
  const id = 'console-01-a';
  try {
    const { pr, gh } = recordsOnGithub(F, id);
    const trunk = tipOf(F, F.console, 'trunk');
    gh.answersAfter({ ...pr, state: 'MERGED', headRefOid: 'e'.repeat(40) });
    const r = F.runIn(F.old, ['merge', id], SUP, gh.env);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, new RegExp(`the records of ${id} did not land in home \\(gh pr merge of home's records PR #9 refused`));
    assert.deepEqual(recordsActs(F, id), [], 'no records act');
    assert.equal(tipOf(F, F.console, 'trunk'), trunk, 'the code did not land');
  } finally { F.done(); }
});

test('R4 records in home, home forge github: the records PR\'s gh pr merge exits non-zero and the state read fails too: refused, nothing lands', () => {
  const F = recordsFixture('kit782-records-no-read');
  const id = 'console-01-a';
  try {
    const { gh } = recordsOnGithub(F, id);
    const trunk = tipOf(F, F.console, 'trunk');
    gh.failsAfter();
    const r = F.runIn(F.old, ['merge', id], SUP, gh.env);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, new RegExp(`the records of ${id} did not land in home \\(gh pr merge of home's records PR #9 refused`));
    assert.deepEqual(recordsActs(F, id), [], 'no records act');
    assert.equal(tipOf(F, F.console, 'trunk'), trunk, 'the code did not land');
  } finally { F.done(); }
});

test('R5 records in home, home forge github: the records PR\'s gh pr merge exits non-zero and GitHub says OPEN twice, then MERGED at the pinned records: their act, then the code lands', () => {
  const F = recordsFixture('kit782-records-lag');
  const id = 'console-01-a';
  try {
    const homeOrigin = F.g(['config', '--get', 'remote.origin.url'], F.old);
    const { r0, pr, gh } = recordsOnGithub(F, id);
    gh.merges(homeOrigin, 'main', `ticket/${id}`);
    gh.answersAfter({ ...pr, state: 'MERGED' }, 2);
    const r = F.runIn(F.old, ['merge', id], SUP, gh.env);
    assert.equal(r.status, 0, `merge exits 0 once GitHub says MERGED on the third read: ${r.err}`);
    assert.match(r.out, new RegExp(`gh pr merge of home's records PR #9 exited non-zero, but GitHub has #9 merged at ${r0.head.slice(0, 12)}: landed`));
    assert.equal(gh.stateReads().length, 3, 'three reads');
    const t = gh.readTimes();
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 1500, `reads ${i} and ${i + 1} are ${t[i] - t[i - 1]} ms apart, not ~2s`);
    assert.equal(recordsActs(F, id).length, 1, 'the records act');
    assert.equal(mergeActs(F, id).length, 1, 'the code act');
  } finally { F.done(); }
});

test('R6 records in home, home forge github: the records PR\'s gh pr merge never answers; merge kills it at its bound, reads the state (still OPEN) and refuses as today, nothing lands', { timeout: 300000 }, () => {
  const F = recordsFixture('kit787-records-merge-hangs');
  const id = 'console-01-a';
  try {
    const { r0, gh } = recordsOnGithub(F, id);
    gh.hangsMerge();
    const trunk = tipOf(F, F.console, 'trunk');
    const r = timed(() => F.runIn(F.old, ['merge', id], SUP, { ...gh.env, ...GH_BOUND }));
    assert.ok(r.ms < WITHIN, `merge refused inside the bound, not after the hung gh pr merge returned (${r.ms} ms)`);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, new RegExp(`the records of ${id} did not land in home \\(gh pr merge of home's records PR #9 refused \\(did its head move\\?\\)\\); nothing landed: verify from the start`));
    assert.equal(gh.prMerges().length, 1, 'one gh pr merge');
    assert.equal(gh.stateReads().length, 3, 'a killed gh pr merge reads as not merged: the state is read, three times while OPEN');
    assert.equal(landedOn(F, F.old, r0.head, 'main'), false);
    assert.deepEqual(recordsActs(F, id), [], 'no records act');
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
    assert.equal(tipOf(F, F.console, 'trunk'), trunk, 'the code did not land');
  } finally { F.done(); }
});

test('R7 records in home, home forge github: the records PR\'s gh pr merge exits non-zero and the state read never answers; merge kills it at its bound and refuses, nothing lands', { timeout: 300000 }, () => {
  const F = recordsFixture('kit787-records-read-hangs');
  const id = 'console-01-a';
  try {
    const { r0, gh } = recordsOnGithub(F, id);
    gh.hangsAfter();
    const trunk = tipOf(F, F.console, 'trunk');
    const r = timed(() => F.runIn(F.old, ['merge', id], SUP, { ...gh.env, ...GH_BOUND }));
    assert.ok(r.ms < WITHIN, `merge refused inside the bound, not after the hung state read returned (${r.ms} ms)`);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, new RegExp(`the records of ${id} did not land in home \\(gh pr merge of home's records PR #9 refused`));
    assert.equal(gh.stateReads().length, 1, 'a killed read is no answer: one read, then refused');
    assert.equal(landedOn(F, F.old, r0.head, 'main'), false, 'the records did not land');
    assert.deepEqual(recordsActs(F, id), [], 'no records act');
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
    assert.equal(tipOf(F, F.console, 'trunk'), trunk, 'the code did not land');
  } finally { F.done(); }
});

test('R8 records in home, home forge github: the records PR\'s gh pr merge exits non-zero and GitHub has it CLOSED at the pinned records: refused, nothing lands', () => {
  const F = recordsFixture('kit787-records-closed');
  const id = 'console-01-a';
  try {
    const { r0, pr, gh } = recordsOnGithub(F, id);
    const trunk = tipOf(F, F.console, 'trunk');
    gh.answersAfter({ ...pr, state: 'CLOSED' });
    const r = F.runIn(F.old, ['merge', id], SUP, gh.env);
    assert.equal(pr.headRefOid, r0.head, 'CLOSED at the very records the checks pinned');
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, new RegExp(`the records of ${id} did not land in home \\(gh pr merge of home's records PR #9 refused`));
    assert.equal(gh.stateReads().length, 1, 'CLOSED is an answer: one read');
    assert.deepEqual(recordsActs(F, id), [], 'no records act');
    assert.equal(tipOf(F, F.console, 'trunk'), trunk, 'the code did not land');
  } finally { F.done(); }
});
