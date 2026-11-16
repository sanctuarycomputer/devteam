# Final review, pass 2

- Reviewer: final-reviewer-2 (fresh subagent, claude-opus, cold confirm)
- Reviewed: b0bdb224f95d69a74599e8f5d5a222c05ece491a (the whole branch; diff since 3ce6acc)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| - | - | - | - | No findings | |

Checked, no issue found:
- Since the pass-1 commit: `git diff --stat 3ce6acc HEAD` shows only reviews/final-1.md (+19). `git log --stat 3ce6acc..HEAD`: 3d3bdec8 adds final-1.md; 473d8fab fills F1's disposition (1 line) and adds dispose-final.sh (+11); b0bdb224 deletes dispose-final.sh (-11). The script nets to zero, and no code, test or doc changed after the reviewed commit.
- F1's disposition (wont-fix): reasonable. F1 is Minor, and the pass-1 reviewer called it non-blocking and the approved spec's design. `git status` runs only for gone sessions that have their own `.git`, with a 10 s cap each. A tick with too little time left relaunches nothing and leaves those sessions for the next tick.
- The pass-1 claims against done_when, from `git diff origin/main...HEAD` on the three touched files:
  - (1) `sessionsToRelaunch` sorts stably by `relaunchTier`. Tier 0 is a dirty own-checkout worktree, a planner with `waiting_on_owner` or an open thread on `planner:<feature>`, `planner:<name>` or its artifact, or a worker in build. Tier 2 is blocked, awaiting-word, or an unanswered last `blocked` message. Tests 9 and 10 assert the full order.
  - (2) `held` adds `isHeld(tickets().get(name) ?? {})`, and test 4 covers `demo-18-held`.
  - (3) The cap is `memoryFull() ? 1 : 3` (null when memory can't be read, so 3). A `worktree_setup` repo needs the full 100 s for a later relaunch. Tests 1, 11 and 12 cover this.
  - (4) The relaunch bullet in supervisor.md §11 states the order, that a held ticket stays down, and 3 or 1 a tick.
- Scope: outside the ticket's records, only the three `touches` files changed.
- CI: `gh run view 43861205206 --json conclusion,headSha` gives `{"conclusion":"success","headSha":"d7905c7a84b3c9cb6e7881923db83da9283ca6a0"}`, which matches verification.md. The commits after d7905c7 add only records. Nothing in the diff gave cause to doubt pass 1, so I did not re-run the tests.

Verdict: APPROVE b0bdb224f95d69a74599e8f5d5a222c05ece491a
