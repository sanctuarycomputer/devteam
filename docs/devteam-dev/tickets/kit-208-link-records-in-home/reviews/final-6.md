# Final review, pass 6

- Reviewer: final-reviewer-l6 (fresh subagent, claude-opus)
- Reviewed: d41c02b3701c4759c20b81126059347caebeabc7 (confirm of the B5-1 / F5-1 fix only)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

No findings.

What I checked:

- Scope: `git diff ee3168c d41c02b --stat -- docs/devteam/scripts/devteam.mjs test/multirepo-home.test.mjs` is empty, so the fix in ee3168c is the code under review.
- (1) The hand-pushed merge stays flagged: `landedRecordsHeads` is gone, along with its call. The final act's `what` now names only `rec.sha`. In test 13, the hand-made plain `--no-ff` merge of the real records commit `first.sha` (viaClean) has a p2 that no act names. merged-without-merge's `heads` set gets only the 40-hex shas after "at " in merge acts, so viaClean is flagged. The test asserts that exactly.
- (2) The records act can't hide anything merge didn't land: it is appended only after `landRecords` returns null; on an error, `die` runs first. It names `rec.sha`, which is the sha `landRecords` merged: the `git merge --no-ff ... rec.sha` path, or `gh pr merge --match-head-commit rec.sha`. So it adds to `heads` only the p2 of the merge it made. With `refs: []`, the act adds nothing to `worded`, so the per-ticket check still fires for a ticket whose code reached main with no ticket-ref act, and nothing reads the ticket as merged. No other code in devteam.mjs reads merge-word acts, and the schema allows empty `refs`.
- (3) The tests guard the fix. I ran each mutation in a private `mktemp -d` archive of d41c02b and always checked the runner's own exit code:
  - Mutation 1: records act not logged (`const ra = { id: "x" }`). `--test-name-pattern 'records in home'` exit 1. Test 8 failed ("the records merge is named by its own act, logged as it landed") and so did test 12 ("each records landing logged its own act; the forged merges have none").
  - Mutation 2: devteam.mjs from ee3168c^, which still has the git inference. Test 13 exit 1: the act named viaClean ("and earlier at 60f54c4…"), which is the B5-1 defect.
  - Unmutated: test 13 exit 0. The mutation-1 run passed tests 6, 7, 9, 10, 11 and 13.

Verdict: APPROVE d41c02b3701c4759c20b81126059347caebeabc7
