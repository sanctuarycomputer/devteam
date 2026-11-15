# Spec review, pass 4 (cold confirm)

- Reviewer: cold-confirm-reviewer-2 (subagent of kit-238-stopped-launch-not-stale)
- Reviewed: a7868c9fe606a4bc8f582bc82e7898e598b02580 (spec.md against the ticket's done_when and devteam.mjs at that head; `git diff f88c904 a7868c9` leaves spec.md unchanged since spec-3's APPROVE)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Checked again at this head:

- Every done-when clause has an acceptance check. Held maps to checks 1 and 4, the stopped launch and its fresh relaunch to check 2, and the real stuck worker to check 3.
- The terms hold against the code. `isHeld` (devteam.mjs:2561) is a non-empty `held` string. `activeWorker` (:2780) reads only the phase, which is the defect the spec names. A worker's phase lines are its own (`workerState` filters on `by`, `lastPhaseOf` on `created_by`), so a `starting` line with no worktree and no window is exactly the stopped shape.
- Contracts: only the optional `not_started` key is added, on stopped rows only. Out of scope names the `liveSessions` residual. Touches are devteam.mjs and test/kit.test.mjs.

Verdict: APPROVE a7868c9fe606a4bc8f582bc82e7898e598b02580
