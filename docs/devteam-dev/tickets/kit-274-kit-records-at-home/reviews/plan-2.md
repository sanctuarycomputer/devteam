# Plan review, pass 2

- Reviewer: plan-reviewer-2 (fresh subagent, claude-opus)
- Reviewed: 5ffe2facbe15728f4ffc40d3b830e23b51610803 (plan.md, diff since 0f73025)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Minor | worker.md §4 (red for the stated reason); plan-1 P1's second half | plan.md T1 first "Run" step | P1 asked the plan to say where the red is expected. That part was not fixed. Under today's code `recordsRepo` (devteam.mjs:2790) sends approve-plan to home for every ticket of a `records: "home"` link. Home has no plan for `console-01-a` (P9's home branch has no folder either), so the first `leftInLink` call already dies in its approve-plan act ("no plan.md for console-01-a on ticket/console-01-a"). The red comes from the helper, not from "A2 says `no records for … in home`" as the plan states. It is still a red that the predicate turns green, but the stated reason is wrong. | fixed at build: T1's red is expected in leftInLink's approve-plan (no plan.md … in home); task-1.md records it; plan.md left as approved |
| P2-2 | Minor | quality.md §6 (the plan says what it does) | plan.md T4 | The P4 and P11 fixes give T4 a merge of the kit's main and an edit to `devteam.mjs`, but T4's "Files:" line still says only `docs/superpowers/**`, and the `reviews/task-4.md` step still says "the 33 files" where T4 now says 35, or every file at the merged head. | fixed at build: T4 also touches devteam.mjs (the comment) after merging main, and its review checks all 35 files; task-4.md records it; plan.md left as approved |

## Pass-1 findings

- P1: fixed for A4/A6. approve-spec and approve-plan now run only when the files include spec.md or plan.md, so the spec-only and no-records tickets no longer die in the helper. The red location was not restated (P2-1).
- P2: fixed. The ref is deleted again after `merge --dry-run`, and pinRecords (devteam.mjs:5516) writes only that ref, so check-pr's fetch-first is now exercised.
- P3: fixed. With the link refs gone and P9's folderless home branch in place, today's `recordsInHomeId(id)` and a views-form decision both lead review-worktree (devteam.mjs:5130-5136) to print `records: …`. Only an at-sha decision prints none, so the check can go red and it covers S8.
- P4: fixed. T4 checks every file at the merged head (35 confirmed at 0f73025 and 5ffe2fac) and T5 re-checks A9 after its merge. The stale wording is P2-2.
- P5: fixed. The TL;DR "Tests" bullet now names one new test plus the A8 change, which matches T1 and T2.
- P6: fixed. A5 commits R first, then the final review naming R, and asserts that only touches fails. A6 edits after that.
- P7: fixed. The home-other clone gets a git identity.
- P8: fixed. check-pr fetches, then decides, and sets `records` and the not-on-origin failure only when the ticket is in home.
- P9: fixed. The folderless home `ticket/console-01-a` (local and origin) exists through A2-A2b, so the TL;DR risk now has a test.
- P10: fixed. The real merge asserts `src/console-01-a.js` on trunk.
- P11: fixed. T4 rewords the comment at devteam.mjs:8301 (confirmed it cites the deleted path).

No new Critical or Important. The plan is still buildable as written, and its TL;DR matches it.

Verdict: APPROVE 5ffe2facbe15728f4ffc40d3b830e23b51610803
