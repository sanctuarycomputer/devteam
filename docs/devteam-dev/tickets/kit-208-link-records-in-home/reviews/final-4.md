# Final review, pass 4

- Reviewer: final-reviewer-h (fresh subagent, claude-opus)
- Reviewed: b3154dcfa6f8fc3b795df65438bb82e6cae44940 (cold confirm, the whole branch)

What I ran, in review-worktree `review-kit-208-b3154dcf-f4` and in private mktemp copies made with `git archive` of the commit under review:
- `test/multirepo-home.test.mjs` at the commit under review: exit 0, 13 of 13 pass.
- Mutation `anc`: I removed only `ancestorOf(h, recSha) === true` from `landedRecordsHeads`. Exit 1. The test "a hand-made merge borrowing the records subject" fails with "neither hand-made merge is named" (the in-folder merge of a non-ancestor gets named).
- Mutation `foot`: I removed only the `changedFiles(p1, m).every(...)` footprint condition. Exit 1. The same test fails the same way (the clean merge of an ancestor that changes README.md gets named).
- Mutation `tree`: I removed only the `mergeTree(p1, h).tree === m^{tree}` condition. Exit 1. The half-done test fails with "neither forged merge is named" (the in-folder evil merge that adds `reviews/final-9.md` gets named).
- Mutation `none`: I made `landedRecordsHeads` return `[]`. Exit 1. The half-done test fails, so B1 holds: the earlier legitimate records merge (`r.head`) is still named.

So F3-1 and B3-1 are fixed. Each of the three conditions is guarded by a test that fails when only that condition is removed, and each forged merge in the tests trips exactly one condition.

Reading the code: `mergeTree` returns `{ conflict }` or `{ error }` and never throws, so a conflicted or unreadable merge has no `.tree` and is not named. A failure there cannot stop the act from being logged after the code has landed.

The rest of the branch is unchanged in these respects:
- Two-repo order: the records land first, at the pinned sha. A failed records landing dies with "nothing landed".
- T3b: a failed code landing after the records dies with "run merge <id> again". On the rerun, `rec.landed` lands only the code.
- The `- Records:` pin: the last line counts, and it must hold at home's records head under the same rule as the verdict.
- With `records` unset, `rec` is null. `checkPr` gets no `records` key, `landedRecordsHeads` is never called, and the act text is the same as before.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

No findings.

Verdict: APPROVE b3154dcfa6f8fc3b795df65438bb82e6cae44940
