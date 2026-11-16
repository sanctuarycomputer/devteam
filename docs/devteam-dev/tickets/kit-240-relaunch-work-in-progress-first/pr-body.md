After a machine stop, `accounts-tick` relaunched gone sessions in launch order, one a tick, and relaunched a held ticket. On the v0.57.0 restart, workers idle on dependencies came back first and the dashboard planner (four owner threads waiting on its mock) came back about ten minutes later; kit-86, held for PR #277, was relaunched.

## What changes

- **Order.** `sessionsToRelaunch` sorts what it finds into three tiers, stable within each (launch order):
  - first, work in progress: uncommitted changes in the session's own worktree checkout, a planner the owner waits on (an open question on its goals or plan branch, or an open thread on `planner:<feature>` or an artifact drawn in its worktree), a worker in `build`;
  - last, a worker idle on a dependency: phase `blocked` or `awaiting-word`, or whose last message to the supervisor is an unanswered `blocked`;
  - the rest in between.
- **Held tickets stay down.** `held()` in `cmdAccountsTick` checks the ticket's `held` field too (so a held ticket stopped at a usage limit isn't restarted either).
- **Up to 3 relaunches a tick** while the machine's memory is under `machine_memory_ceiling` (or unread), 1 at or over it. Every relaunch still goes through the restart record and its caps. When the session's repo has a `worktree_setup`, a later relaunch in a tick starts only with the full 100 s left, so it is never cut short into a spent attempt; a session passed over is not claimed. Supervisor and limit restarts are unchanged (one a tick).
- `supervisor.md` §11's relaunch bullet says the order, that a held ticket stays down, and the per-tick count.

## How to verify

`node --test --test-concurrency=2 test/recovery.relaunch.test.mjs`: the order (two tests), a held ticket, up to 3 a tick under the ceiling with one not due, one a tick at the ceiling, and the `worktree_setup` rule. Records: `docs/devteam-dev/tickets/kit-240-relaunch-work-in-progress-first/` (spec, plan, reviews, verification).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
