# Task review, T1 (the test), pass 1

- Reviewer: task-reviewer (subagent of kit-238-stopped-launch-not-stale)
- Reviewed: 80907a98bd7bc9f2584eb9600c41798ff20c6e47 (T1 is 16dc1cf, the new test at the end of test/kit.test.mjs, read against spec.md acceptance checks 1 to 4 and plan.md T1)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec Behaviour changes (observe-metrics ready and active) | test/kit.test.mjs:777-851 | Nothing asserts the observe-metrics ready list or its active count (the idle-capacity finding's "N/M workers active" and its ready ids). Reverting either line at devteam.mjs:11499 or :11545 to plain activeWorker leaves the test green. The spec's acceptance checks don't name these, so the approved test scope is met. | |
| F2 | Minor | spec Terms (stopped launch) and Behaviour changes (makeSession) | test/kit.test.mjs:777-851 | The worktree arm of stoppedLaunch is never exercised alone: no ticket has a worktree and no window while its last phase is starting, so deleting the existsSync check at devteam.mjs:2788 leaves the test green. Of makeSession's three new-start gates only drain is checked, not coverage-gap or the memory ceiling under --resume. Spec check 2 names only drain, so this is coverage beyond the approved checks. | |

Checked:

- Each acceptance check is asserted. Check 1 is w-01-held with a live window: no stale-worker, HELD and no STALE, not in active, listed under held, `active workers: 1/`. Check 2 is w-02-stopped, both with no tmux session and with one: not_started true, `not started` on its row, no stale-worker, back in ready, refused under a draining goal, made again with a fresh starting line and its worktree, and `not started` gone afterwards. Check 3 is w-03-stuck: build phase, window present, high stale-worker, `[build, Nm STALE]`, in active, and active_per_component.web is 1. Check 4 is w-04-held-stopped: HELD wins on the line, not_started true in JSON, not in active, listed under held.
- It goes red without each of these code changes: the stale-worker isHeld and stoppedLaunch skips (deepEqual on the stale subjects), cmdReady's skip and active filter (ready, held and active asserts), deriveStatus not_started, cmdStatus HELD and not-started display, makeSession ranBefore (the F.fails under drain), and the tmux arm of stoppedLaunch (w-01-held must not be not_started). F1 and F2 list the lines that survive a mutation.
- It is deterministic. The phase lines are 2 h old against a 30-minute threshold, ids are explicit and distinct, and w-03's two lines are a minute apart. A failed tmux spawn fails the test loudly, never passes it.
- Cleanup: the early `return` when tmux is missing still runs `finally`. `tmux kill-server` uses the fixture's env (its own TMUX_TMPDIR), so only the fixture's server dies. F.done() removes the fixture, including the worktree it made under F.old.
- The no-tmux block runs before any session exists and outside the hasTmux gate, as the spec says.
- Only test/kit.test.mjs is touched, which is in touches.
- Re-run once at 80907a9 through the isolated runner (`run-file.sh … test/kit.test.mjs 'stopped launch'`): exit 0. The test ran (tests 5, pass 1, fail 0, 4 skipped by the name pattern) with tmux installed, so the window and relaunch parts ran.

Verdict: APPROVE 80907a98bd7bc9f2584eb9600c41798ff20c6e47
