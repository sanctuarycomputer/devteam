# Spec review, pass 4

- Reviewer: spec-reviewer-4 (fresh subagent, claude-opus)
- Reviewed: 78f57ca4a255598b621015b2a1510005efecf1f5 (spec.md, diff since eb0af35)

Checked against done-when 1 and 2 (`ticket show kit-242-awareness-data`), `explained()`/`covered()` (devteam.mjs:10510-10524) and `learningFigures` (devteam.mjs:10616-10630).

- S3-1 is fixed. A ruling now counts only when it was made at or after the group's first sighting. That is exactly when `covered()` (`at <= ruling`, equality included) marks a sighting, so `learningFigures`' `by` is non-empty. Call 3 now says the same, so its claim that the rule agrees with `learningFigures` holds. Taking the earliest such ruling as `x` fits with `explained()` keeping the latest ruling per key: any ruling at or after the first sighting is enough to cover it.
- S3-2 is fixed. Each ruling's `o-` ref names an observation on a different key, so the citation bullet can't stand in for the ruling path. Cases now cover these mutations: ruling path dropped (the 2 h case and the before-the-third case flip), spec-2's at-or-after-forming limit (the before-the-third case flips) and no lower limit (the before-the-first case flips). See S4-1 on the wording.
- S3-3 is fixed. `base.slice(0, 110 − suffix.length) + suffix` has one reading. The `dup:z`/`dup/z` fixture gives `aw-signal-dup-z` and `aw-signal-dup-z-2`, which I checked by hand against the `effId` rule (devteam.mjs:12302).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S4-1 | Suggestion | worker.md §4 (a check must fail when the feature is broken; the spec's claims about its checks must be true) | spec.md §Acceptance checks 1, Signals, "Each value flips if the ruling rule is dropped, or if it is given spec-2's at-or-after-forming limit, or no lower limit at all" | Read literally, this is false. The 30 h case reads "doesn't count" under all three mutations. The 2 h case still counts under the forming limit and with no lower limit. What is true is that each mutation flips at least one listed value: dropped → 2 h and before-the-third; forming limit → before-the-third; no lower limit → before-the-first. The 30 h case guards another mutation: a ruling read as 0 hours whenever it is made. Fix: "Each of these mutations flips at least one value", and name which case guards which. This doesn't block the build, because the cases themselves are right. | wont-fix the plan's fixture table names which case catches each broken ruling rule; the spec stays as approved |

Verdict: APPROVE 78f57ca4a255598b621015b2a1510005efecf1f5
