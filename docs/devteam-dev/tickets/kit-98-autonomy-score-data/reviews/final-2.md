# Final review, pass 2

- Reviewer: k98-final-2 (fresh subagent, claude-opus-5-5)
- Reviewed: 923877b9e78152220c1b48bcbccd9a95892ad88a (pass-1 fixes b82fc25, the merge 394a16a, verification 923877b)

This pass is diff-only. I read final-1.md (F1 Important, F2 Minor, both disposed as fixed in 54d3f850) and every commit since c5f2505: edc054c, 54d3f85, b82fc25, 394a16a and 923877b.

**The pass-1 fixes.** b82fc25 only fills in final-1.md's two disposition cells. The test fix itself is 54d3f85, and it touches only test/autonomy-data.test.mjs (+8/−1):
- Week 6 gains a third rung decision and an owner preference. It now reads alone 2 of 3, asked 1, score 67.
- Week 8 gains a supervisor-created goal with a supervisor `hold: {mode: 'drain'}` update and a supervisor-written `class:priority-change` lesson. asked stays 6.

The disposition says "a running goal", but the goal is created with status `draft`. That makes no difference: the filter checks only the writer and the hold field.

**Mutations.** I ran them in a scratch worktree at 923877b, under a private mktemp dir, with every DEVTEAM_* variable unset, a fresh HOME per run and DEVTEAM_HUB_PORT=4385. Each run was `node --test --test-concurrency=2 test/autonomy-data.test.mjs` on its own, and the file was restored between mutations.
- Unmutated: 10 pass, 0 fail, 0 skipped.
- Dropping `writerClass(u.by) === 'owner' &&` from the goal-update filter (devteam.mjs:10533): 2 fail ("each week's decisions…" on `week 8 asked`, and "a stored record wins…"). F1 is fixed.
- Dropping `writerClass(k.created_by) === 'owner' &&` from isOwnerRule (:10523): the same 2 fail on `week 8 asked`. F1 is fixed.
- `Math.round` → `Math.floor` in autonomyWeek's score (:10569): 1 fails, on `week 6 score`. F2 is fixed.

The scratch worktree was removed with `git worktree remove --force`.

**The merge.**
- `git diff c5f25051 394a16a1 -- docs/devteam/scripts/devteam.mjs` is empty. Main's merged range didn't touch devteam.mjs, and kit-98's code there is unchanged. Every changed line in that diff is also in main's own diff from the merge base (90abe27) to 394a16a^2 (90e932b), so the merge brought in main's changes only.
- `git diff origin/main...HEAD --name-only` (origin/main at de177ac) lists only devteam.mjs, test/autonomy-data.test.mjs, test/fixtures/g1/dashboard-data.txt and files under docs/devteam-dev/tickets/kit-98-autonomy-score-data/.
- Main has moved 10 commits past the merge (release-prep v0.60.0, kit-244). That is outside this pass.

**Verification.** verification.md cites test.yml run 43855126462 at 394a16a171d41c86194746828fd42f4b69f350e9. `gh run view 43855126462` gives conclusion `success`, headSha 394a16a171d41c86194746828fd42f4b69f350e9, and all 17 jobs `success`. Its week 6 and week 8 rows match the new fixture.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | quality.md §3 (the record must be accurate) | docs/devteam-dev/tickets/kit-98-autonomy-score-data/verification.md:3 | It credits the final-1 fixes to "b82fc25: two week-6 and week-8 fixture additions". b82fc25 is the dispositions commit. The fixture additions are 54d3f85, which final-1's dispositions cite correctly. Fix: name 54d3f85. | wont-fix, with the reviewer's agreement: the fixes are 54d3f85 (b82fc25 holds the dispositions); verification.md:3 should read 54d3f85, and editing it after the final APPROVE would void the verdict, so this disposition is the correction of record |

Verdict: APPROVE 923877b9e78152220c1b48bcbccd9a95892ad88a
