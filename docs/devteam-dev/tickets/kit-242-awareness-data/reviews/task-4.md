# Task review: task 4, pass 1

- Reviewer: task-reviewer-4 (fresh subagent, claude-opus)
- Reviewed: 6c85db3e535ffa8e8feb991bcf409e0776f835a6 (task 4, diff since c41463f)
- Spec compliance: ✅ `autonomyScore` follows spec "The Autonomy Score" (mean of three, Math.round, null when any is null, this_week/last_week = weeks[11]/[10]); placed right after `autonomy`; one `now` passed to all three blocks; G1 golden gains only `autonomy_score` (12 null scores, this/last null), matching plan "What G1 holds".

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T4-1 | Minor | spec.md acceptance check 3, "How it fails: a wrong ... rounding ... rule changes the hand-written value" | test/awareness-data.test.mjs, `autonomy score: the mean of the three` | Week 7 is (100+100+50)/3 = 83.33, so a `Math.floor` (or truncation) mutation still yields 83, and the recompute loop uses `Math.round` itself; floor-vs-round is not caught. Ceil, a 2-place round and wrong weighting are caught. The code is correct; the fixture (plan oracle) just has no fraction at or above .5. | fixed in aad8812 (vm test: 100,100,51 gives 84; task-4-2 APPROVE) |
| T4-2 | Minor | spec.md acceptance check 3 (`this_week` and `last_week` equal `weeks[11].score` and `weeks[10].score`) | same test | Both weeks 10 and 11 are null in the fixture (efficiency null), so swapping `this_week`/`last_week`, or hard-coding either to null, still passes; the assertion is vacuous here. Code is correct by reading. | fixed in aad8812 (distinct this_week and last_week; task-4-2 APPROVE) |
| T4-3 | Minor | spec.md acceptance check 4 (one clock read, S1-2) | test/awareness-data.test.mjs, `one clock` | `starts_at` equality only detects a second `Date.now()` read across a Monday 00:00 UTC boundary, so it would pass with `autonomyData()` called without `now` on almost every run. The check is the one the spec names and the code passes the one `now` to all three (verified at `dashboardDataRead`), so no change is required. | wont-fix the reviewer notes the code passes one now to all three blocks and the test is the check spec check 4 names |

Verdict: APPROVE 6c85db3e535ffa8e8feb991bcf409e0776f835a6
