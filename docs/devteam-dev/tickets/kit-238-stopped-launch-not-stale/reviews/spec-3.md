# Spec review, pass 3 (cold confirm)

- Reviewer: cold-confirm-reviewer (subagent of kit-238-stopped-launch-not-stale)
- Reviewed: f88c9041a73b43e37d58f0860d70a16d38cc50a2 (spec.md against the ticket's done_when and devteam.mjs at that head; `git diff 9536720 f88c904` touches plan.md and the review records only, so spec.md is unchanged since spec-2's APPROVE)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Checked cold, not from spec-2's word:

- Done-when 1 (held) maps to checks 1 and 4; done-when 2 (stopped launch, relaunch as a fresh start) to check 2; done-when 3 (real stuck worker) to check 3. Every clause of each done-when has an assertion.
- The definition of a stopped launch holds against the code: `activeWorker` (devteam.mjs:2780) is phase-only, `resolvePane` reports `no tmux session "…"` / `no tmux window "…"` (:15409-15410), the worker's `starting` line is written after the worktree and window exist (:16055), and `cmdReady` (:3797-3825) is the only reader of `max_active_per_component`.
- The relaunch gates follow from `started`/`ran` and the drain refusal text at :15931 ("a draining goal finishes what is running and starts nothing new").
- Out of scope names the `liveSessions` residual plainly; touches are devteam.mjs and test/kit.test.mjs, and the spec asks for nothing else.

Verdict: APPROVE f88c9041a73b43e37d58f0860d70a16d38cc50a2
