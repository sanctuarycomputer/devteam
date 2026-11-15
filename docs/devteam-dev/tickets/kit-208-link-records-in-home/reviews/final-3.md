# Final review, pass 3

- Reviewer: final-reviewer-e (fresh subagent, claude-opus)
- Reviewed: ecbcbfa4bbca4d355b153102f7e5752aec9ac7c1 (cold confirm, the whole branch)

What I ran, in review-worktree `review-kit-208-ecbcbfa4-f3` and in a private mktemp copy:
- `test/multirepo-home.test.mjs` at the commit under review exits 0 (12 of 12 pass).
- A: removing both of the fix's conditions (`ancestorOf(h, recSha) === true` and `changedFiles(p1, m).every(...)`) makes the half-done test fail with "the forged merge is not named". B2-1's forged merge stays flagged, and the test fails without the fix.
- D: making `landedRecordsHeads` return nothing makes the same test fail. B1 still holds: the earlier legitimate records merge is named.
- B: removing only the footprint condition: the test still passes.
- C: removing only the ancestor condition: the test still passes.

Reading the code: the fix is correct as written. A head is named only when it is the second parent of a two-parent first-parent merge, is an ancestor of `rec.sha`, is not `rec.sha` itself, and its merge changed only `tickets/<id>/`. The footprint condition is the only thing that catches an evil merge of a legitimate ancestor head. `recordsBranchFails` reads from merge-base, and that base already contains such a merge. The two-repo merge order is unchanged since final-2: records land first, then the code, and a failed code landing dies with the "merge again" message (T3b). The `- Records:` pin, where the last line counts, is unchanged. With `records` unset, `rec` is null, `landedRecordsHeads` is never called, and the act text is as before.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F3-1 | Important | quality.md §3 (Scoped: mutate the code, check a test fails; Important: a missing test with a plausible failure path); final-2b B2-1 (fix and its test) | test/multirepo-home.test.mjs:487-497; docs/devteam/scripts/devteam.mjs:5133 (`landedRecordsHeads`) | The B2-1 fix has two independent guards, but the forged merge in the test trips both of them. It merges a head that is not an ancestor of the records sha, and it changes README.md, which is outside the records folder. Deleting either guard alone leaves the suite green (mutations B and C, exit 0). Two real B2-1 cases therefore have no test: (1) a hand-merged edit to `tickets/<id>/spec.md` under the records subject, from a head that is not an ancestor of the records sha, which final-2b named; without the ancestor guard it is named by the act and hidden from merged-without-merge. (2) an evil merge of a legitimate ancestor head that also changes a file outside the folder; without the footprint guard it is hidden, and nothing else catches it, because `recordsBranchFails` reads from merge-base. A later edit to that one-line filter could reopen B2-1 with CI green. Fix: add two forged merges, or two cases: one whose head edits only `tickets/<id>/` and is not an ancestor of `later.sha`; and one that merges an ancestor of `later.sha` (for example `r.head` before the move, or a commit on the records branch) with an extra out-of-folder change in the merge commit. Assert each stays merged-without-merge and is not named. | |

Verdict: CHANGES ecbcbfa4bbca4d355b153102f7e5752aec9ac7c1
