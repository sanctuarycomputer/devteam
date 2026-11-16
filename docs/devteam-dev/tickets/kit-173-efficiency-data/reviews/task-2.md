# Task review, task 2

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus-5-5)
- Reviewed: a29256bdfff57a9c826ac4f5b76886925064bdbd (963fb48..a29256b)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-1 | Minor | spec Edge cases: "All scored weeks have defects: each takes its others' lowest raw value" | test/efficiency-data.test.mjs (score tests) | No fixture has two scored weeks that both carry a defect, so a `scoreWeeks` that took the others' *substituted* parts (instead of their raw `best / value`) passes. Two defect weeks (e.g. $1/pt and $2/pt) would pin that each reads the other's raw ratio. | wont-fix: Minor; the all-defect case is the same code path as the tested one-other-week case; deferred |
| T2-2 | Suggestion | spec shape: `best: { usd_per_point, hours_per_point } // lowest among scored weeks; null when none` | devteam.mjs `scoreWeeks` returns `{ best: null }` | With no scored week `best` is `null` as a whole (G1 golden: `"best": null`), not an object of nulls; the plan's Review Focus 3 says "`best` nulls". Either reading fits the spec comment; kit-174 should be told it is the whole object. | wont-fix: Suggestion; best is null with no scored week, as the spec's shape says; kit-174 is told in the PR |

Verdict: APPROVE a29256bdfff57a9c826ac4f5b76886925064bdbd
