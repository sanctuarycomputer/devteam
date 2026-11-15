# Task review, T1 (the test), pass 2

- Reviewer: task-reviewer-2 (subagent of kit-238-stopped-launch-not-stale)
- Reviewed: 0d499212c23aab4167379d7f3d4800985b54892c (the test's extension in 4369b23, read against reviews/task-1.md F1 and F2, spec.md Terms and Behaviour changes, and devteam.mjs stoppedLaunch and the observe-metrics ready and active lines; cd9c08f and 0d49921 touch neither devteam.mjs nor test/kit.test.mjs)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Suggestion | none | test/kit.test.mjs:822-829 | The memory-full guard never skips under the harness: test/lib/kit.mjs:36-37 points DEVTEAM_CGROUP and DEVTEAM_MEMINFO at a missing path, so machineMemory is null and memoryFull is always null. The skip is sound (idle-capacity is withheld while memory-full fires), but the memory-full detail carries the same `N/M workers active` text, so an else branch could assert `2/` there too and keep the active-count check in both cases. | wont-fix the skip is sound and never taken in the fixture; checking the count in memory-full text would change an approved test for a branch the fixture cannot reach. |

Checked:

- task-1 F1 is addressed. The no-tmux block now asserts the idle-capacity finding: subject matched by `/ready$/` (the `${ready.length} ready` subject; the `fix ready` variant cannot fire here, no fix tickets and active is under the cap), detail `^2\/\d+ workers active` (w-03-stuck and w-05-worktree, against the default max_active_tickets 5), suggestion naming w-02-stopped (the metrics ready list keeps a stopped launch; insertion order is fixed and the run passes, so it is within the first five). This matches devteam.mjs:11568-11570.
- task-1 F2 is addressed for the worktree arm. w-05-worktree has a starting line, its worktree at `<F.old>/.worktrees/w-05-worktree` (F.old is the cwd the kit runs in, so mainRoot), and no window. The test asserts it is stale, has no not_started, and is in ready's active. The worktree is made with `git worktree add -q -b ticket/w-05-worktree <path> origin/main` in F.old, the same pattern the G1 fixture uses (test/lib/kit.mjs g1Outputs). The coverage-gap and --resume memory gates stay untested; the author's Minor disposition gives the reason (they share ranBefore with the drain gate, which is tested), and spec check 2 names only drain, so this blocks nothing.
- w-05 in component api leaves the web assertions as the spec has them: active_per_component.web is still 1; staleOf, the active deepEqual, the held list and the not_started deepEqual all filter by the four web ids. The text `active workers: 2/` counts w-03-stuck and w-05-worktree, which is right: w-05 counts as a worker, neither held nor stopped.
- Deterministic: the new phase line is 2 h old against 30 minutes, the ids are fixed, the memory guard is always false under the harness (F1), and nothing depends on wall-clock order beyond what pass 1 checked.
- Cleanup: the extra worktree and its git metadata live under F.base (F.old's tree and F.old/.git/worktrees), which F.done() in `finally` removes, with the tmux server. The early `return` without tmux still runs `finally`. The local branch ticket/w-05-worktree doesn't collide with `worker w-02-stopped` later.
- Runs through the isolated runner, judged by exit code: the test at 0d49921, exit 0 (tests 5, pass 1, fail 0, 4 skipped by the pattern). Deleting the worktree check in stoppedLaunch (one line), exit 1, failing at kit.test.mjs:819 (w-05 not stale). Reverting the metrics active count to `[...ts.keys()].filter(activeWorker).length`, exit 1, failing at kit.test.mjs:826 (no idle-capacity: 5/5). devteam.mjs restored after each; `git status --short` clean.

Verdict: APPROVE 0d499212c23aab4167379d7f3d4800985b54892c
