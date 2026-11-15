# Plan review, pass 2

- Reviewer: plan-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: c20206322e9c8c05415c59c1ae762a856a9396ba (plan.md, the fixes for plan-1)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Important | done-when 1-2 (fixture logs with known answers); P4's fix ("phase lines placed relative to their merge"); code: cycle = first phase line to merge (devteam.mjs:11234-11239) | Review Focus 1 (`at(k, f)`, "phase line at f, its spend at f + 0.1, its merge at f + 0.2"); Task 1 Step 1 (`at(k, offsetHours)`, "phase line 10 h before merge"); Task 2 Step 1 (w11 8 h/pt) | P4's fix creates a new contradiction. (a) Review Focus 1 places every ticket's phase line at a fixed fraction of the week before its merge: 0.2 × 6 days = 28.8 h for k < 11, and 0.2 × 0.9 × (now − thisMonday) for this week. So the hand-computed hours can't be built that way: Task 1's 10/20/2 h, and Task 2's 10/20/5/8 h/pt. For w11 the hours depend on `Date.now()`, so the score test's 8 h/pt (and its 55) would be wrong or flaky. (b) Task 1 Step 1 names the helper `at(k, offsetHours)`, but Review Focus 1 defines `at(k, f)` with f a fraction. (c) f ∈ (0, 1) with the merge at f + 0.2 can fall past the week (k < 11: up to monday + 7.2 days) or into the future (k = 11: up to 1.08 × elapsed). Fix: put merges, spend and observations at `at(k, f)` with f ≤ 0.8. Put each phase line at merge − (its hours), where it may fall in an earlier week; only merged-in-week and spend count, and a phase line that early changes no week's figures. Give the helper one signature. Space this week's events by at least a second, since `mergedAt` reads `%cI` at second resolution: a run within seconds of Monday 00:00 UTC can wait, or use the previous week's fixture. | |
| P2-2 | Minor | spec AC4 per-pass estimate ("over the 12 weeks' tickets with at least one `final` review record") and tighter-specs ("first passes among the week's tickets") | Task 4 Step 1, `review depth and tighter specs priced per pass` | The fixture doesn't pin two things its hand answers need. First, this week's S/normal and M tickets have no `final-*.md` records; this week is one of the 12, so any final record would add them to the per-pass median, which would no longer be 4. Second, the S/normal tickets' 3 spec/plan records add no `plan-1.md`/`plan-2.md`; if they did, the plan stage's first passes, CHANGES share or later passes would move, and so would usd 8. Say so, e.g. that the S tickets' records are `spec-*` only. | |
| P2-3 | Minor | spec AC2 (best over all scored weeks) | Task 2 Step 1, `a defect week with the lowest dollars still sets best` | The new case must be its own fixture. In the 4-scored-week fixture the step names, a $1/pt week would make best_usd 1 and change every answer in `score against hand-computed answers`. It also needs ≥ 3 tickets in each of w2 and w4, and their hours, to be scored. State both. The numbers are right: w4 spend 1/2 = .5; w2 (defect) takes the other scored week's raw .5. | |
| P2-4 | Minor | plan matches spec at c202063 | Task 1 **Files** ("`reviewStats` (~3957)"); Task 1 test `review folders are read once per request` ("`deriveStatus` … each run twice"); Rulings, last bullet | Stale after the memo moved into `ticketReviews`. The change is to `ticketReviews` (~3945) and `dashboardData`; `reviewStats` and `reviewPasses` don't change. `deriveStatus` runs four times per request (also twice through `collectProgress`, 11758, from 11842 and 10624), not twice. The Rulings bullet still describes the read as one "across `reviewStats` and `reviewPasses`" and cites "its latest approved pass", but the spec has no approve-spec yet. Wording only: the test's expected n = number of tickets is right. | |

The plan-1 findings are resolved, except as noted:

- P1: resolved. The id is checked against `^[a-z0-9][a-z0-9-]{0,110}$`, and there is no `thread new`. `us.anthropic.Claude-Opus-5-5-20261001` lowercases, then strips its prefix and date to `claude-opus-5-5`.
- P2: resolved. `claude-haiku-4-6` is not a `MODEL_PRICES` key (10946-10951), and the newest priced haiku is `claude-haiku-5-5` (5.5 > 4.5), output $0.5 < $15.
- P3: resolved with the spec's exact-key rule. `claude-opus-5-1` is not a key, the newest priced opus is `claude-opus-5-5` (5-5 > 5 > 4-8), and $20 < $50.
- P4: unique ids, the `supervisor` writer and spread times are added, but see P2-1.
- P5: resolved. Classification is by file name.
- P6: resolved. The tighter-specs tickets are size M; see P2-2 for what is still open.
- P7: resolved. The not-lower price (sonnet-5-5 at $25 against opus' $20), the unknown family and the `review` phase ($2 of X) are tested.
- P8: resolved. The memo is in `ticketReviews`, and the test counts real reads.
- P9: resolved. The two runs are back to back, and the internals hang on `m` at 11314, before the findings at 11709.
- P10: resolved, with P2-3.

Hand-checked numbers, all right:

- Per-week: (3+8+1)/4 = 3, (10+20+2)/4 = 8.
- First pass: 4 first passes, 2 rejected, 0.5.
- Score: best 2 and 5; 67, 58, 72; w11 .4 + .25 + 1 = 55; one defect week 25.
- Smaller model: 20 × (1 − 10/20) = 10.
- Per-pass median: (4+2)/2 = 3, 4/1 = 4, 10/2 = 5, median 4; review depth 3 × 4 = 12; tighter specs 2 × 4 = 8.
- Cache: 2M × (4 − 0.2) / 1e6 = $7.60.
- Costly ticket: 40 − 5 × 2 = 30.

The TL;DR has seven bullets, and they match the plan and the spec.

Verdict: CHANGES c20206322e9c8c05415c59c1ae762a856a9396ba
