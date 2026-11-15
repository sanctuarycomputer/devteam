# Spec review, pass 2

- Reviewer: spec-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: fb3e384394f9ca2aa4c96868af560e3bf73a8b2c (spec.md, the fixes since 53807ad)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S2-1 | Minor | Test determinism (pass-1 S13); `hours_waiting` counts open questions "until now" | spec.md Acceptance 2 | "The fixture's lines are dated from this Monday, never from now" fixes the split across weeks. But if a line is dated some hours after Monday 00:00 UTC, a run early on Monday puts it after `now`. A question open at that point then gets an interval `[asked_at, now)` that is negative or clipped. So this week's expected `hours_waiting`, and anything else bounded by now, still depends on when the test runs. Date this week's fixture lines no later than `now` (for example, `min(monday + offset, now − margin)`), or compute this week's expected open-question hours from `now` in the test. Minor: the implementer can handle it in the plan. | fixed in plan.md: this week's lines at M + span*f (never after now), hours_waiting checked between tBefore and tAfter (Review Focus 1, Task 1 table week 11) |

Pass-1 findings, checked against the diff and the code:
- S1: fixed. **alone** = `calls()` created in the week whose authority is `rung`, `standing-rule` or `constitution` (`authority` for a decision, `actAuthority` for an act). `answer` and `default` are left out, and defaulted questions are now counted in **asked**. This matches `actAuthority` (devteam.mjs:5490) and the decision authorities at ~8936-8953. The acceptance check adds an answer-approved act and a default-approved act. No call is counted twice: a correction dated in the call's week removes it from alone, and a later correction counts only in its own week's corrected (Edge cases updated, and the old floor-at-0 case dropped).
- S2: fixed by ruling `m-20261115-224929460-supervisor`, quoted under Rulings. needed ≥ has follows from has ⊆ in place ⊆ needed and is tested.
- S3: fixed by the same ruling. Approach and Calls 1 say that the split is counted from the log.
- S4: fixed. Every field is numeric, a week with nothing reads 0, and a week with no decisions has score 0 while its other counts stand.
- S5: fixed. A rule is knowledge the owner wrote, of kind `preference` or with a `class:` scope, counted at `created_at` even if retired later. An owner's fact is left out. Both the kind and the scope pattern exist in log.schema.json.
- S6: fixed. **corrected** matches `learningFigures`' `all.filter(c => inW(correctionOf(c)?.at))` (devteam.mjs ~10016), and the cohort effect is stated.
- S7: fixed. The exclusion is now five explicit conditions. `answered_at` is set for withdrawn questions (`questionView` ~1828), so "settled at or before Q's asked_at" can be checked. The test writes a `new_because` Q by hand, and past-week drift is noted.
- S8: fixed. The walk caps each point by the ceiling and by the incident-fix cap, as `rungFor` does (~5452), from the capped start, so it ends at `rungFor`. The cap uses today's release-production rung, which the spec states.
- S9: fixed. alone is described as `calls()` (owner acts and the tidy of a finished worktree excluded), matching devteam.mjs:2041.
- S10: fixed. A working sensor counts as had.
- S11: fixed. A missing figure reads 0.
- S12: fixed. `lessons` (this week's `lists.knowledge`) is added to the shape. Ended weeks give `[]` and rely on `record`, so a computed ended week has neither link. That is acceptable.
- S13: fixed for the week split (see S2-1 for what remains).
- S14: fixed. A module-level cache keyed by week, line count and last `at`.

Verdict: APPROVE fb3e384394f9ca2aa4c96868af560e3bf73a8b2c
