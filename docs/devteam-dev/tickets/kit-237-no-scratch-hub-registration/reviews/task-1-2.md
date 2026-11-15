# Task 1 review, pass 2

- Reviewer: task-reviewer 1-2 (fresh subagent, claude-opus-5-5)
- Reviewed: cf7c1b83175d9cd05480a5f3792e40b56e933d72 (test/machine.test.mjs, Task 1)

I read reviews/task-1.md and `git diff 51d6147 HEAD -- test/machine.test.mjs`. I checked each fix against its finding, using `until` in test/lib/kit.mjs, the env scrub at the top of test/lib/kit.mjs, the file's `baseEnv` and `machine` helpers, the dashboard's `accountsTick` (devteam.mjs ~14624), `registerOnMachine` and `sessionRun` (~12767-12786), and how accounts.json is written (temp file then rename, ~13916).

What I ran, all at `--test-concurrency=2`:
- At HEAD: `--test-name-pattern='session.s dashboard|stray hub records' test/machine.test.mjs`. 2/2 pass.
- Non-vacuity of M1. I extracted `git archive HEAD docs/devteam test` into four scratchpad copies. In each copy I removed one clause from `sessionRun`: the DEVTEAM_TICKET check, the DEVTEAM_FEATURE check, 'worker' from the role list, or 'planner' from the role list. Then I ran the dashboard test in each copy. Each copy fails on exactly its own single-mark case: 'a ticket alone', 'a feature alone', "a worker's role alone" and "a planner's role alone": its dashboard records nothing. The copies are now removed.
- Before and after each run, `ls ~/.devteam/repos-4320/` listed exactly 37843d29b620c303.json 525596261976375a.json a26b983ab68cac7a.json b3ed4fa05c718174.json d6ea08ca2e1e63a4.json.

What holds:
- M1 fixed. The loop runs a dashboard with each mark alone. kit.mjs strips every session DEVTEAM_* from process.env at import, so `baseEnv` adds no mark of its own. The hub port is explicit, so the tick child's own `registerOnMachine` checks only `hubRecordOff`, and the child's env is stripped to role supervisor. That leaves the dashboard's hand-off as the only thing that can silence it. The mutation runs above confirm this. Reusing `w` across the cases is sound: every case expects no record, so a record left by one case can only make a later case fail, never pass.
- N1 fixed. Status runs through the sync `machine()` helper, which has the same cwd and env as before, and the test is no longer async. Nothing in-process needs to serve during the call: its only contact with the hub is a read-only GET to the box's hub. `execFile` is still imported because other tests use it (lines 841, 1111, 1181).
- N2 fixed. The predicate either returns the file's `at` or throws `assert.fail` naming the output once `exitCode` is set. `until` awaits `f()` without a catch, so the throw propagates at once. The `finally` now kills the dashboard, awaits its exit and runs the 1.5 s settle on every path, including a failure, before the outer cleanup. stdout and stderr are both drained by listeners, so the pipes cannot fill.
- N3 fixed. The comment now matches the code: the tick child writes accounts.json last, by rename, so one file means one settled record, and the second tick is a margin. Because the write is a rename, `at()` never sees a partial file. The second wait's `at() !== first` therefore cannot end early on a half-written read.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| N1 | Nit | test hygiene: diagnostics | test 2, `dashboard` helper, first `until` | The early exit checks only `d.exitCode`. A dashboard killed by a signal has `exitCode` null and `signalCode` set, so it still falls through to the 2-minute timeout, which is the pre-fix behaviour. `d.exitCode !== null` could also read `said` before the pipes have drained. The kit's own helper (test/lib/kit.mjs 512) checks both `exitCode` and `signalCode`. This is a failure path only, so it can wait. | no change: failure path only; a signal-killed dashboard still fails, after the wait times out |

Verdict: APPROVE cf7c1b83175d9cd05480a5f3792e40b56e933d72
