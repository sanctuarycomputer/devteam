# Task 4 review, pass 1

- Reviewer: task-3-4-reviewer (fresh subagent, claude-opus)
- Reviewed: 1bfda3403d5c75e68ddad19afdc1b9753946af55 (task T4)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T4-1 | Suggestion | - | docs/devteam/process/supervisor.md:325 | "Up to 3 a tick" doesn't say that a supervisor or limit restart earlier in the same tick counts toward the 3 (spec Edge cases). The code shares `tries`, so after a limit restart a tick brings back at most 2, and that "first" relaunch already needs the full 100 s when its repo has a `worktree_setup`. The text is still true as an upper bound. Optional clarification. | fixed: §11 says a restart earlier in the same tick counts toward the 3 |

Checked against done_when 4 and the code at 42aaab8 / 1bfda34:
- Order: work in progress first (uncommitted changes, a planner the owner waits on through a question or a thread on it or its mock, a worker in `build`), sessions idle on a dependency last (`blocked`/`awaiting-word`, or an unanswered `blocked` as its last message), launch order otherwise. This matches `relaunchTier`.
- Held: "its ticket's `held` field set: a held ticket stays down" matches `isHeld` in `held()`. The other causes in the parenthetical match the code: goal or fleet parked or let go via `sessionMode`, drained via `draining()`.
- Per-tick count: 3 under `machine_memory_ceiling` or when memory can't be read, 1 at or over it. This matches `memoryFull()` and the cap. The restart record and caps are still shared.
- The reworded 100 s sentence (the first relaunch has up to 100 s; a later one whose repo has a `worktree_setup` starts only with the full 100 s left, else it waits, so a slow setup means one a tick) matches `budget(cap, need)`.
- The rest of the bullet is unchanged. The limit-restart bullet's "one session per tick" is still accurate.

Verdict: APPROVE 1bfda3403d5c75e68ddad19afdc1b9753946af55
