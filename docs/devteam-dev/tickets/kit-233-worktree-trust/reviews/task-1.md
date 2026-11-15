# Task 1 review, pass 1

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: fe6adbc234dd4f5b11a13e19e85a8aa805bf2a8e (test/kit.test.mjs, the last test)

I read the test against plan Task 1 steps 1 to 8 and spec checks 1 to 3, and `threadsFixture`, `fleetFixture` and `until` in test/lib/kit.mjs. The test's own `run` and `tmuxOut` go through the threads `F.env`, which deletes DEVTEAM_SUPERVISOR, as do `F.sup` and `F.owner`, so nothing from the outer session reaches a kit or tmux call. `LANG` travels only in this test's env (en_US.UTF-8 on darwin, C.UTF-8 elsewhere, as machine.test.mjs does). Every metrics pass waits first for the launch's line in calls.jsonl and its last screen line in the pane, so no pass can read a pane tmux has not drawn yet. The tmux server is killed in `finally` and `F.done` removes the base, including the chore-trust worktree. The test at fe6adbc, run in a detached scratch worktree, is red for the right reason: `'a folder-trust dialog is a blocked prompt'` at step 3. At e35663c it passes in about 8 s. The negative cases bite: without the `!busy` gate the busy screen would match `Quick safety check:`, and without the line anchors the mid-line mention would match.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec Change 2 (F4, the real path) | test/kit.test.mjs, the hook step | `named` is compared with `fs.realpathSync(<worktree>)`. On Linux, os.tmpdir() has no symlink, so the realpath and the plain path are the same string, and a change that passed `wt` instead of `realPath(wt)` as DEVTEAM_WORKTREE would still pass on CI (ubuntu). Only a macOS run (/var to /private/var) covers F4. A symlinked fixture path, or a note in verification.md, would close the gap. | wont-fix: CI is Linux, where the temp dir has no symlink; the realpath is set in code (task 2) and a macOS run covers it |
| F2 | Minor | spec Change 2 (60 s timeout) | test/kit.test.mjs, the failing-hook step | Only a non-zero exit is tested. The timeout branch and its warning text are not, and neither is the limitStop change, which the plan already leaves to verification.md (F6). The spec does not ask for a timeout test, so this does not block. | wont-fix: not required by the spec; verification.md notes the timeout and limitStop paths are untested |
| F3 | Suggestion | Test clarity | test/kit.test.mjs, `target = ...` after the first `planner` | If the `made planner plan-big in ...` regex ever misses, `target` becomes `=undefined:plan-big` and the test waits 2 minutes before it fails with `launch 1 showing Enter to confirm`. Asserting the match first would give a clear failure. | fixed: the test asserts the launch output before it waits |

Verdict: APPROVE fe6adbc234dd4f5b11a13e19e85a8aa805bf2a8e
