# Task 3 review, pass 1

- Reviewer: task-3-4-reviewer (fresh subagent, claude-opus)
- Reviewed: 42aaab82e409134a45527b6d35ff73d0aa1d11c1 (task T3)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T3-1 | Minor | plan T3 Code ("The comment \"one relaunch a tick\" updated") | docs/devteam/scripts/devteam.mjs:13368 | The comment above `RESTART_CHILD_MS`/`RESTART_TICK_MS` still says "one relaunch a tick". Only the comment in `cmdAccountsTick` was updated. This constant now bounds the first of up to 3 relaunches, so the comment is stale next to the values that set the budget. | fixed: the comment above RESTART_* says the per-relaunch budget and the 30 s / 100 s rule |
| T3-2 | Minor | spec Edge cases ("The existing first test … gains the under-the-ceiling case (both in one tick)") | test/recovery.relaunch.test.mjs:24 | The first test only gained the full-memory pin. Nothing checks a worker and a planner coming back together in one tick under the ceiling. The new "up to 3" test covers that case with workers only, so the planner branch of `hasWorktreeSetup` (`repo('home')`) and a mixed tick under the ceiling are never run. The plan's T3 bullet narrowed this, so it doesn't block. | fixed: the worktree_setup test's second session is a planner, so hasWorktreeSetup's home branch runs |
| T3-3 | Suggestion | - | docs/devteam/scripts/devteam.mjs:15298 | `hasWorktreeSetup` is evaluated for every gone session after the first attempt, including sessions that `tries >= cap` or the restart record will turn away anyway. That costs a repo/settings read per session for nothing. It is correct (`repoReadable` guards `repo()`'s exit, and `componentLink` never dies). Checking `tries < cap` first would skip the read. | fixed: hasWorktreeSetup is read only while tries < cap |

Checked:
- Behaviour against spec "Per-tick count" and plan T3:
  - `budget()` with its defaults (cap 1, need `RESTART_MIN_MS`) is the old rule for the supervisor restart and the limit restarts.
  - The relaunch cap is read once, only when something is gone: `memoryFull()` gives 1, otherwise (including memory that can't be read) 3.
  - `tries` counts `relaunched`/`failed`/`left` but not null or `gave-up`. Earlier supervisor or limit restarts count toward the cap.
  - A passed-over session gets budget 0, and `claimRestart` only looks with 0 (returns null or `gave-up`, writes nothing). No claim is released.
  - The 120 s limit holds: every child gets `min(RESTART_CHILD_MS, RESTART_TICK_MS - elapsed)` and only starts with at least `need` (≥ 30 s) left, all measured from `began` at the top of the tick.
  - `hasWorktreeSetup` uses the same repo `makeSession` seeds from (worker: `repoOfTicket`; planner: home). It checks `repoReadable` before `repo()` and treats an unreadable repo as having a setup (plan-3 F3-1).
- Mutations in scratch copies of 42aaab8 (`git archive`, then `git init` and a commit), each running the whole of `test/recovery.relaunch.test.mjs`:
  - Unmodified: 12/12 pass.
  - (a) cap always 3: tests 1 ("one relaunch per tick"), 3, 8, 9 and 10 fail. Killed.
  - (b) cap always 1: test 11 fails ("three, passing over the one not due"). Killed.
  - (c) the `need` rule dropped (always `RESTART_MIN_MS`): test 12 fails ("under 100 s left for another"). Killed.
- Test 11 also pins that nothing is claimed: demo-81-notdue's record still holds its one attempt, and demo-84-d comes back in tick 2, which it couldn't do if tick 1 had claimed it. Test 12 checks the restart record has no entry for the two sessions that waited.

Verdict: APPROVE 42aaab82e409134a45527b6d35ff73d0aa1d11c1
