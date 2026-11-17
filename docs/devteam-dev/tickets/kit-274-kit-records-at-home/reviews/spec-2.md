# Spec review, pass 2

- Reviewer: spec-reviewer-2 (fresh subagent, claude-opus)
- Reviewed: 1d83f55090af6a5182258b2199830de8ec52c2cf (spec.md, diff since ebb5dcd)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S2-1 | Minor | spec "Where it's computed" (Cost, S5) | spec.md "Cost" bullet | The S5 fix batches only home main's `tickets/`. The link side is still one read per ticket, plus "only for refs that resolve", which needs a resolve per ref unless the refs come from one listing. Until the copy-and-delete chore lands, about 270 merged kit tickets have folders only in the kit's main, so each status or dashboard read still spawns about one git call per ticket (more for the ref resolves). Fix: list the link main's `<project>/tickets/` once per log read too (`ls-tree`), and resolve home's `ticket/*` and `origin/ticket/*` from one `for-each-ref` listing per log read. Not blocking: the cost is transitional and goes away after the chore. | fixed in plan.md T1 (link main's tickets/ listed once per log read; spec text left as approved) |

## Pass-1 findings

- S1 fixed. checkTicket decides once at its resolved sha and carries the decision in src (`inHome: H`) to ticketReviewsRead, with the memo key including it. The touches exemption and recordsHold already key off H inside checkTicket, so every records read in the command follows one decision. merge passes its decision through a new `inHome` option. In check-pr, checkTicket decides again, but at the same full sha with the same refs after the fetch, so it gets the same answer. A2b (link refs deleted, as in CI) fails if reviews go through the views form. When implementing, "uses src.inHome when set" must treat `false` as set; A2b catches a truthy test.
- S2 fixed. merge and check-pr --repo fetch home's `origin/ticket/<id>` before their first decision. A2c (home records pushed from another clone, absent locally) fails if either decides before the fetch.
- S3 fixed. The inherited call sites are listed: approve-plan through recordsRepo, parkMessage, recordsParkProblems, recordsLandedOnly, ensureRecordsWorktree, promptFor, worker --remove, timelineView, and home's check-pr on ticket/<id>. A7 adds approve-plan in both directions; the refusal text matches the code at devteam.mjs ~9678. A8 states the one change to the existing setting test at test/multirepo-home.test.mjs ~199-205: home gets a spec first, so the test becomes home-wins and keeps its assertion. That changes one existing test's setup, not a done-when.
- S4 fixed. The memo goes through the kit's `memo()`, which is scoped to `readLog()` (devteam.mjs ~2824), so the dashboard decides again on its next log read.
- S5 partly fixed. Home main is listed once; the link side is still per ticket (S2-1, Minor).
- S6 fixed. The warning prints once per process per ticket from check-ticket, check-pr and merge, and A2 asserts exactly one occurrence for check-pr and merge --dry-run.
- S7 fixed. The rollout note says those merges bring the kit folder back, orders the chore after kit-100, kit-90 and this ticket (or once more per later merge), and gives an `ls-tree` check that must come back empty.
- S8 fixed. review-worktree decides at its sha.

Done-whens: all four are unchanged in the ticket. The diff only adds checks (A2b, A2c, extensions to A2, A7 and A8) and removes none; A8's one test change is stated and keeps its assertion. No new Critical or Important.

Verdict: APPROVE 1d83f55090af6a5182258b2199830de8ec52c2cf
