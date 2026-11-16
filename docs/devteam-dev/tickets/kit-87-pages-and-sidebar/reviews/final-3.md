# Final review, pass 3

- Reviewer: final-reviewer 3 (fresh subagent, claude-opus-5-5)
- Reviewed: edf372d35ca72843c4dc3b25b9f73e2946957c10 (diff from 0c02ae84, pass 3)

I read the rules, quality.md §3, final-2.md with its dispositions, spec.md's last Rulings line (m-20261116-095757248), the fixer's "Fix 2" report, and the diff 0c02ae84..edf372d3. Apart from code commit 667a5454, it adds only the final-2 record and its dispositions. 667a5454 touches only `docs/devteam/dashboard/index.html` (readyCard and drawSettings, outside both frozen blocks, no new top-level name) and `test/dashboard-pages.test.mjs`, both in touches. In review worktree `final3` at edf372d3, on /usr/local/bin/node v22, `test/dashboard-pages.test.mjs` gave exit 0, 6/6 passing, 0 skipped. I ran two mutations of "settings page", one at a time. Dropping the pending "Parity –" line failed at "the rows stay put as the answer comes (1 blockers)". Setting `old = false` failed at "no green ready badge after a failed check". I removed the worktree afterwards.

**Navigation waits.** `evNav` returns false only for a message that matches navigated or closed, Cannot find context, context was destroyed, or Execution context. Every other error is rethrown, and `until` doesn't catch it, so the test still fails. An error that keeps matching only turns into `until`'s labelled timeout, so no real failure is hidden. The message that `p.ev` builds includes the expression text, but none of the three expressions passed to `evNav` contains those words. `reload()` replaces the two copies of the reload wait unchanged, except that the wait now goes through `evNav`. No assertion changed.

**Card space and rows test.** Until the first answer, the card draws a pending line and a "Parity –" line. An answer with one blocker or none, plus the parity, takes the same two rows. The new loop proves this for both answers, within 1px, and the mutation confirms it. "settings rows as thread targets" only adds a wait, `!FLEET.busy && !!FLEET.data && !FLEET.wantFetch`, before it aims at a row. No assertion was removed or loosened. The fixer's own new assertion, `/^(not )?ready to move$/`, follows a real server answer and still checks that the old mark is gone.

**F2-1, ADDRESSED.** When `FLEET.data` is set and `FLEET.error` is set, the badge is a plain `.badge`, never `.good`, reading "last check failed; this is from <when(FLEET.at)>". `FLEET.at` is set only on a good answer (index.html:2843), so the date is the old answer's. A good check clears the error and the mark. The test and the mutation prove it. One green mark is left on the card (F3-1).

**F2-2, ADDRESSED.** Focus goes back to Check now only when the active element is the body, nothing, or Check now itself. A limit control the owner focused keeps focus: drawSettings first restores it, and then it doesn't match. The test focuses No limit while the check is held, and focus stays there. A plain check still gets its focus back (asserted).

No new Critical or Important defect.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F3-1 | Minor | done-when 3 as amended (Ready to move? at all times, with Check now refetching it); final-2 F2-1 disposition ("never green") | docs/devteam/dashboard/index.html:2918 | After a failed check that follows a good answer with no blockers, the badge is neutral and dated, but the "Nothing left before a move" row keeps its green dot. The badge above marks the answer as old, so it is not misleading on its own, but the card still shows one green mark from a stale answer. A neutral dot when `old` is set would match the badge. | wont-fix: the badge above already marks the whole answer as old (last check failed; this is from <when>); a code change now would void the final verdict past the review cap (m-20261115-214211599); named in the merge request for a follow-up |
| F3-2 | Suggestion | none | docs/devteam/dashboard/index.html:2912 | The space held for the answer covers one blocker or none. An answer with two or more blockers, or a blocker that wraps, still pushes the Settings rows down once on a cold arrival. The fixer's report says so too. The test is protected by its new settle wait, and the owner sees one shift at most. | wont-fix: fetching readiness at every page load would cost the check the page keeps for a held fleet or Settings; one shift on a cold arrival with two or more blockers, named in the merge request |

Verdict: APPROVE edf372d35ca72843c4dc3b25b9f73e2946957c10
