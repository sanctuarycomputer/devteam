# Plan review, pass 3

- Reviewer: plan-reviewer-3 (fresh subagent, claude-opus-5-5)
- Reviewed: 4765c9c3e03e9b888fff3feb93d7f6e02d41aa89 (plan.md, the fixes for plan-2)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P3-1 | Minor | Review Focus 1 ("a run near Monday 00:00 UTC"); `mondayOf` (devteam.mjs:9752) | Review Focus 1, the `span` < 10 minutes skip | The skip covers a run that starts just after Monday 00:00 UTC. It does not cover a run that starts just before it. If the fixture is built late on Sunday (`span` close to 7 days, so no skip) and `dashboard-data` runs after 00:00, `efficiencyWeeks(Date.now())` shifts every week by one. Then week 9's tickets read as week 8's and this week's as week 10's, and every hand answer fails. The chance is small, but it is the case this focus item names. Fix: take `thisMonday` once, and also skip when `thisMonday + 7 days − Date.now()` is under a margin (e.g. 10 minutes). Or, after the CLI run, skip if `weeks[11].starts_at` is not the `thisMonday` the fixture used. | wont-fix in the plan text (it would void the approval): the build's test checks weeks[11].starts_at against the Monday the fixture used and skips with the reason when they differ |
| P3-2 | Minor | plan's own claims ("`hours_per_point` is exact", "phase < spend < merge") | Review Focus 1, `mergeAt(11, i)` | For k = 11, `thisMonday + span × (0.5 + 0.01 i)` is not a whole second. `mergedAt` reads the commit date, which git keeps to the second, so the merge reads up to 999 ms earlier than `mergeAt` returned. Two results: (a) the cycle can be up to 1 s short. `hours()`'s `toFixed(1)` still gives 8.0, so the w11 answers (8 h/pt, score 55) hold, but the time isn't literally exact. (b) With `span` between 10 and about 16.7 minutes, `span/1000` < 1 s, so the spend line can land after the truncated merge, which breaks the stated phase < spend < merge. Nothing computed depends on that order: `ticketUsd` sums the ticket's spend items with no merge cut-off (devteam.mjs:11278), and the spend stays in this week. Fix: `Math.floor` `mergeAt` to whole seconds (k < 11 already gives whole seconds). Then the cycle is exact and `merge − span/1000` (≥ 0.6 s) stays before the merge. | wont-fix in the plan text: the build rounds mergeAt down to whole seconds |
| P3-3 | Minor | spec AC4 review-depth ("≥ 3 … records … between them") and tighter-specs (≥ 4 first passes, more than half CHANGES) | Task 4 Step 1, `review depth and tighter specs priced per pass` (P2-2's fix) | "the S/normal tickets' records are `spec-1.md`, `spec-2.md`, `plan-1.md`" can be read as each ticket's records. With two S tickets that is 6 records, so usd is 24, not 12, and plan first passes are 3 CHANGES of 6. That is not more than half, so tighter-specs disappears. The hand answers hold only if the three records are the total (one S/normal ticket, or spread across tickets). Also, "the plan stage [doesn't] move" isn't literally true: the S ticket's `plan-1.md` APPROVE takes plan first passes from 4 to 5. The answer still holds (3/5 = 60% > half; later passes still 2, usd 8). Say "one S/normal ticket, whose records are …" and "the condition and usd 8 still hold". | wont-fix in the plan text: the build's fixture has exactly one S/normal ticket with those three records |

Plan-2 findings, checked against the diff:

- P2-1: resolved, apart from P3-1 and P3-2.
  - There is one helper, `mergeAt(k, i)`, used with one signature in Review Focus 1 and Task 1.
  - For k < 11, `monday(k) + 3 days + i hours` falls on Thursday, inside [monday(k), monday(k+1)) for i < 96. It is a whole second and in the past.
  - For k = 11, `thisMonday + span × (0.5 + 0.01 i)` is ≥ `thisMonday + span/2` and < now for i < 50. With `span` ≥ 10 minutes, tickets are 6 s or more apart, so they stay distinct at git's one-second resolution.
  - Phase lines sit at merge − cycle. The cycle is first phase line to merge (devteam.mjs:11234-11239), so for k < 11 the week-9 answer (10 + 20 + 2)/4 = 8 is exact, and w11's 8 h/pt rounds to 8.0 (see P3-2).
  - A phase line in an earlier week changes no week's figures. Weeks count merges and spend `at` (`through`), not phase lines.
  - Spend in its merge's week: for k < 11, merge − 1 minute stays Thursday. For k = 11, merge − span/1000 ≥ `thisMonday` + 0.499 span.
  - Tests that need this week's events skip when `span` < 10 minutes.
- P2-2: resolved, apart from P3-3. Neither of this week's ticket groups has a final record, and the S records add no plan pass after `plan-1`.
- P2-3: resolved. The case has its own fixture (`eff-best`), with 3 S tickets per week and equal hours and first passes. Numbers: best_usd 1; w4 spend 1/2 = .5; w2 (defect) gets the other scored week's raw .5.
- P2-4: resolved. Task 1 now names `ticketReviews`, at line 3945 as stated. "Several times per request" is right. The Rulings bullet cites spec-4 at `c202063`, and spec-4.md approves c20206322e9c…, with no spec change since.

The hand-computed answers still hold with the new helper: per-week 3 and 8; first pass 0.5; score 67, 58, 72 and 55; the one-defect week 25; smaller model 10; per-pass median 4, review depth 12, tighter specs 8 (on P3-3's reading); cache $7.60; costly ticket 30. The diff adds nothing that contradicts the TL;DR.

Verdict: APPROVE 4765c9c3e03e9b888fff3feb93d7f6e02d41aa89
