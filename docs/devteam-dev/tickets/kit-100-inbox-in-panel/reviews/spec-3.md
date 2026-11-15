# Spec review, pass 3

- Reviewer: reviewer-spec3-k100 (fresh subagent, claude-opus)
- Reviewed: 7f6ef6bf0706a8bf6ccea47a68348076a5c3ce65 (spec.md, the fix for S2-1 only)
- S2-1 is fixed by 9a956bd. AC4 no longer answers `q1`: its API-answer bullet is gone, so AC4 leaves the fixture and the count of 9 as built. AC5's first bullet now names `q1` and, right after its Answer and one redraw, checks that no pin is drawn inside `#th-inbox` and `tlInboxHome(Q)` is false. `q1` is first consumed there, so it is a fresh question for AC5. The order paragraph (AC1 to AC4 and AC7 on the fixture as built, AC5 last, AC5 alone changing the count) is now true. No new contradiction about counts or ordering.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S3-1 | Minor | quality.md §3 (cross-references stay true) | spec §4 edge case "A question answered in another tab" ("No pin is left in the panel (§2.6, AC4)") | The no-stale-pin check moved from AC4 to AC5, but the §4 edge case still cites AC4. Point it at AC5. Not blocking. | wont-fix for now: the reference is corrected in T0's spec reconcile commit at build, so this approving verdict stands |

Verdict: APPROVE 7f6ef6bf0706a8bf6ccea47a68348076a5c3ce65
