# Final review, pass 1

- Reviewer: final-reviewer (fresh subagent, claude-opus)
- Reviewed: 3ce6acc1c07eae6991837fe975a3e15b6fc20140 (the whole branch)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec Design (tiering cost) | devteam.mjs `sessionsToRelaunch` / `relaunchTier` | Every gone session's `git status` (10 s timeout each) runs before the first relaunch, and its time comes out of the tick's 110 s (`began` is earlier). After a cold reboot with many large worktrees this can leave under 30 s, so that tick relaunches nothing; it heals on the next, warmer tick, and only a pathological 12+ x 10 s would reach the 120 s kill. This is the design the spec approved; noted, not blocking. | |

Checked, no issue found:
- done_when 1: tests 9 and 10 cover the order: a dirty worktree with its own `.git`, a planner with an open question / an open thread on `planner:<feature>`, `planner:plan-<feature>` or an artifact at its worktree, and a worker in build come first; `blocked` / `awaiting-word` / an unanswered blocked last message come last; answered or superseded blocked messages, a withdrawn question and a resolved thread stay in tier 1; a stray change in the main checkout is not read. The sort is stable, so ties keep `lastLaunches()` order.
- done_when 2: `held` adds `isHeld(tickets().get(name) ?? {})` (planners get `{}`, so false); test 4 has `demo-18-held`.
- done_when 3: cap = `memoryFull() ? 1 : 3` (unreadable memory means 3, as spec and §11 say). The supervisor and limit restarts call `budget()` with cap 1, so there is still one a tick there. A restart earlier in the tick counts toward the relaunch cap. A passed-over session gets budget 0, and `claimRestart` claims nothing for it (it reports gave-up only as before). `need` is `RESTART_CHILD_MS` only for a later relaunch whose repo has a worktree_setup, and `budget` never goes past `min(100 s, left)` of 110 s. Tests 1, 11 and 12 cover this.
- `hasWorktreeSetup`: checks `repoReadable` before `repo()` (which exits), and a planner reads home, as `sessionOf` does.
- done_when 4: supervisor.md §11's bullet states the order, that a held ticket stays down, up to 3 / 1 a tick, and the worktree_setup rule.
- Scope: outside docs/devteam-dev/, only the three touched files changed. d7905c7..3ce6acc adds only verification.md.
- verification.md: `gh run view 43861205206` gives `{"conclusion":"success","headSha":"d7905c7a84b3c9cb6e7881923db83da9283ca6a0"}`, which matches. My own run of test/recovery.relaunch.test.mjs at 3ce6acc: 12 pass, 0 fail.

Verdict: APPROVE 3ce6acc1c07eae6991837fe975a3e15b6fc20140
