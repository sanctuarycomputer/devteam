# Task 1 review, pass 2 (confirming T1-1 and T1-2)

- Reviewer: task-1 confirming subagent

Scope: commit 6f232c65, `test/owner-setting.test.mjs`, test 'null means no limit wherever a cap is read', only as it bears on T1-1 and T1-2 in reviews/task-1.md.

Checked, in a scratch `git worktree` at 6f232c6 (removed after). DEVTEAM_* were unset, HOME was a scratch dir and DEVTEAM_HUB_PORT was 4397. Each run was `node --test --test-concurrency=2 --test-name-pattern "null means" test/owner-setting.test.mjs`.
- Baseline, nothing changed: pass 1, fail 0.
- T1-1: I put metrics' whole memory-full condition back to its old form, comparing against `settings.max_active_tickets` directly in both arms with no `capOf`. The test fails at `memory-full is raised with no limit`. The fixture (`max_active_planners: 0`, then `incident_slots: 1`) leaves the cap arm as the only path, and the new `doesNotMatch(/waiting for a planner/)` closes the planning path too. Confirmed fixed.
- T1-2: I put the fix-ready idle-capacity condition back to its old form (`active >= settings.max_active_tickets && active < settings.max_active_tickets + incident_slots`). The test fails at the "exactly one idle-capacity" assertion, because a false `1 fix ready` finding now appears next to the plain one. `incident_slots: 2` makes the old null reading true. Confirmed fixed.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE 6f232c657c7365704846583fb4cc81af254ecaee
