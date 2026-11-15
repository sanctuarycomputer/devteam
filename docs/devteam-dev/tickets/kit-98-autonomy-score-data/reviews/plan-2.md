# Plan review, pass 2

- Reviewer: plan-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: 3fb420af2cb7e3153e13b251485de709527abd76 (plan.md, the fixes since 1121da5)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Minor | quality.md §3 (a test must be able to fail) | Task 1 test `the operator's words count nowhere`, the `machine tell` half | `machine tell <fixture repo> "…"` with "the test accepts any exit" can pass without running the tell path at all. `machineTell` (devteam.mjs:13481) dies with usage (exit 2) when its first word holds a `/`, so a repo path gets there, and `machineSpeaker` (13437) dies first when `DEVTEAM_ROLE` is supervisor/worker/planner or the log writer isn't the supervisor. Pass the repo's basename, and give an env with no `DEVTEAM_ROLE` and the fixture `HOME`. Then assert exit 1 or 3 ("no such adopted repo" or "not told: no supervisor is up"), not 2, so the test shows the tell actually ran. `machineTell` never calls `appendLog`, so the outcome is right either way. That is why this is Minor. | |

Pass-1 findings:
- P1 confirmed fixed. TL;DR bullet 3, the `autonomyWeek(start, now)` interface, Review Focus 2 and a new Rulings line all say there's no cross-request cache. That matches the code: each `/api/data` request runs `dashboard-data` in a fresh `execFile` child. The cost bound is stated correctly: no refold for this week (the fast path), and at most 11 folds per request for ended weeks with no stored record, 0 once `observe-metrics` has written them. This week isn't memoized. The handling is acceptable. The spec's cache line (S14) can't be built, the plan records where it departs from the spec and tells the supervisor with approve-plan, and the spec's cost goal is kept as well as it can be.
- P2 confirmed fixed. Both cross-run comparisons strip `hours_waiting`. The second-GET check (`weeks[11].alone === 2`) doesn't depend on the clock.
- P3 confirmed fixed. An owner goal verdict (`decision: { verdict: 'approve' }`) is added. `decisionRecords` (5522–5532) emits a row for each owner goal update with a decision or a hold, and the supervisor's `new` line isn't in `updates`. Recomputed week 8: asked = q1 (answered), q2 (defaulted), hold, verdict, preference, class rule = 6. alone = 2 (d1, and d2, whose correction is at h(9,1,0), after week 8 ends). corrected = 1 (d3). decisions = 9. score = round(200/9) = 22. Matches.
- P4 confirmed fixed, but weakly; see P2-1.
- P5 confirmed fixed. Y needs `start < 2 ≤ ceiling`, Y ≠ X, neither is `incident-fix`, and the test fails loudly if no such pair exists.
- P6 confirmed fixed. Recomputed with REASK_GLUE (5696): P → {raise, importer, rewrite, above, billing, export, work} (7 words; "should", "we" and "the" are glue). Q → the same 7 with "uploader" in place of "importer". 6 shared, union 8: 0.75 ≥ 0.7. Matches the plan. q3's wording and class differ from P's. The fact is accepted. Answer lines carry no `question_hash`.
- P7 confirmed fixed. For `post`, `sensorCredentialState` (18081) returns `posted` when every `secrets` name is in `secrets_posted`. So `post` is in has and not in working. The new name lists are consistent.
- P8 confirmed fixed. The cache shape is spelled out, with name mappings for `proposals` and `missing`.
- P9 confirmed fixed. floor10(tBefore − M) ≤ h ≤ ceil10(tAfter − M), in hours. q5 covers week 11 from M up to now.
- P10 confirmed fixed. Recomputed: in the main fixture, week 10 is q5 alone, [W(11) − 2h, W(11)) = 2.0. Week 8's union is [h(8,1,10), h(8,1,16)) = 6.0, and a withdrawn question's end is its `answered_at`, which is set (1828). The class rule counts by `created_at` in week 8, it's retired in week 9, and it's left out of week 11's `lessons`. In the second fixture, q0 asked at W(0) − 1 day and still open gives 168.0 in each of weeks 0–10. Weeks 0–5 of the main fixture stay all zero, and week 9 stays at decisions 1.

Verdict: APPROVE 3fb420af2cb7e3153e13b251485de709527abd76
