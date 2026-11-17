# Task 2 review, pass 2 (cold confirm, diff-only)

- Reviewer: task-2 confirm reviewer (fresh subagent, claude-opus)
- Reviewed: 86102f6 (fix diff b208951..86102f6)
- delta-3 F1: not yet in scope (Task 3)

| Pass-1 id | Status |
|---|---|
| T2-1 | ADDRESSED. `closedGoalCardHtml` dates the last `updates` entry whose `status` equals the goal's, or shows no date, never `created_at`. The test asserts g4's and g5's real dates and uses a synthetic goal (opened 2026-01-02, closed 03-04 or 03-05, no status update). Mutation m1 put back the `created_at` fallback, and the Chrome test failed. |
| T2-2 | ADDRESSED. The head reads `priority n · <impact words>` again, and g1 and g2 assert it as exact strings. Mutation m2 put impact first, and the test failed. next-step.strategy:261 now asserts that Goals has no Strategy link (spec §7), and the strategy-file href is asserted on the peek's Why it matters link, so the intent is kept. Line 263 is unchanged and passes. dashboard-peek:1332 now clicks Let go on the goal peek's Hold, as m-20261117-152227607 asks. It asserts `Confirm let go`, and the hash and drawer stay on that goal's peek, so nothing else opens. |
| T2-5 | ADDRESSED (taken). The page's unscoped `.steps` rules are gone, `.step-sub` included. The layout block's lines 161–169 cover every removed rule, so the done/now colour check now pins the shell's rules. |
| T2-3, T2-4 | Not in scope (Suggestions). |

Also checked:
- 571171d (Upkeep's ⋯) is justified. The mock's `head()` puts the ⋯ on every card head, Upkeep's included. In T2, Upkeep's card became a record card (`data-open="goal/upkeep"`), which brought it under kit-88's "every record card: one ⋯" contract. The change is one `cardHead` argument (`id`, `open`).
- The flipped kit-88 "stepper is fenced" assertion is justified. The peek now draws `goalStepsOf` (the shell's `goalSteps`, index.html ~4438). The shell's `.steps` rules exclude `.no-shell`, and the page keeps no copy, so a fenced bar would be unstyled. In the same subtest, the bar is still checked for the card's styles, so the assertion is not weakened.
- The Goals ⋯ check's selector now skips Upkeep (`:not(.upkeep)`). It still checks a goal card, so it is not loosened, and Upkeep's ⋯ is covered by the record-card subtest.
- Neither shell block changed. The fix hunks sit at index.html ~552 and ~3149+, outside `devteam-layout` (46–206) and `devteam-shell-js` (1165–1437). Files changed: index.html, the three touched tests and this ticket's reviews/ only.
- Runs (rt90.sh, all 0 skipped): dashboard-overview-goals 4/4, next-step.strategy 6/6, dashboard-peek 37/37, dashboard-shell 16/16.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

No new findings.

Verdict: APPROVE 86102f6089787ec88b4a52450802675051f1f707
