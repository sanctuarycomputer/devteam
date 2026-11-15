# Final review, pass 6, track b

- Reviewer: final-reviewer-m6b (fresh subagent, claude-opus)
- Reviewed: d41c02b3701c4759c20b81126059347caebeabc7 (confirm of the B5-1 fix only, adversarial)

Scope: the B5-1 fix (ee3168c). landRecords' landing now logs its own merge-word act with `refs: []`, `landedRecordsHeads` is gone, and the final act names only the records sha it checked. I ran the probes as extra tests in a private `git archive` copy of the commit, one file at a time with `timeout 900 node --test --test-concurrency=2`, and judged each run by the command's own exit code.

The fix holds:
- **No act for a landing that didn't happen.** The act is appended only after `landRecords` returns null, and every failure in it returns a reason, so merge dies first. This covers a merge that doesn't apply, a refused push and a refused `gh pr merge`. Probe P1: home's origin refuses the push. merge exits non-zero ("did not land in home") and no records act is logged (pass).
- **The act names the sha that landed.** It names `rec.sha`. That is the exact commit landRecords merges (`git merge --no-ff rec.sha`) or pins (`--match-head-commit rec.sha`).
- **A hand-made merge is no longer named.** Only merge itself writes `merged home's ticket/<id> at`. The branch's test (0), a plain `--no-ff` merge of a real records commit pushed by hand, stays flagged.
- **No reader takes the new text for a ticket merge.** `/^merged ticket\/(\S+) /` (line 9682) and `mergedAtSha` (`merged ${branch} at ${sha}`, line 16060) don't match "merged home's ticket/…". With empty refs the act doesn't feed `worded` or `approvalOf`, and it has no `decision`, so it can't count as carrying out one (line 5256).
- **The empty refs hide nothing.** Probe P2: a half-done merge, then the code merged into console's trunk by hand. `metrics` flags `merged-without-merge` with subject `console-01-a`, and status reads `merged`, which git says is true. merge run again says "already on trunk: nothing logged", and there is still exactly one records act (pass).
- **The half-done retry is still idempotent.** `rec.landed` skips both the landing and the act. In the branch's moved-head test the landings are exactly `[r.head, last.sha]`.
- **The tests fail without the act.** As a mutation I replaced the records `appendLog` with a stub. "merge checks the records at one pinned sha…" then fails ("the records merge is named by its own act"), and so does "a half-done merge, then a review record added…" ("each records landing logged its own act").

Outside the fix, no finding: the detector skips any merge whose second parent is a named head (`heads.has(p2)`). Probe P3: a half-done merge, then a forged `commit-tree` merge on home's main that edits README.md, with p2 = the landed records head. It is not flagged. That is the detector's existing contract for every merge act: the final act named this same sha before the fix, as `merged ticket/<id> at <sha>` acts do. The fix moves it earlier, to the moment the records land, and that matches what merge actually did. Keying `heads` by merge commit rather than by head would close it for every merge. That would be a ticket of its own.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| B6-1 | Minor | quality.md §3 (comments and readability) | docs/devteam/scripts/devteam.mjs:5391-5393 | The comment above the records landing still says a failed code landing leaves "no act logged". Since the fix, the records act is logged. It should say "no merge act for the ticket". | |
| B6-2 | Minor | quality.md §3 (correct but worse than it should be) | docs/devteam/dashboard/index.html:1651 (`actView`, `merge-word`) | With `refs: []`, the dashboard's act feed shows the records act as "Merged merged home's ticket/<id> at <sha>: the records of <id>, …". The word is doubled, and the line reads as a merge in the owner's feed. A case for the `merged home's ticket/` prefix (e.g. "Landed the records of <id> in home") would fix it. | |

Verdict: APPROVE d41c02b3701c4759c20b81126059347caebeabc7
