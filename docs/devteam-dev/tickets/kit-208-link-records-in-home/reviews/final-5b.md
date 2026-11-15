# Final review, pass 5, track b

- Reviewer: final-reviewer-k5b (fresh subagent, claude-opus)
- Reviewed: 5fdaa41a058ae6b898b3d03ff45fc5ab97646b72 (cold confirm of final-4b, adversarial)

The B4-1 fix holds for the case it was written for. `ancestorOf(h, p1) === false` stops the empty merge of an old main commit, and the branch's test covers it. `changedFiles` is `--no-renames`, so a rename into the folder can't hide an edit outside it. A conflicting merge gives no tree, so it is never named. The subject must match exactly, and an octopus merge is never named.

I still made it name a head that merge never landed, and so hide an evil merge. The probe is an extra test in a private `git archive` copy of the commit, run on its own with `--test-name-pattern`. The command exited 0, and both cases were logged.

- Probe (withA=true). Start from `readyInHome` for console-01-a. Records l1 (spec, plan, verification: `r.reviewed`) are pushed, then the final review on top (recSha). Before `merge` runs, someone pushes two commits to home's main. (a) A faithful `git merge --no-ff -m "console-01-a: records" <l1>`: a worker's push of records that had no final review yet. (b) `git commit-tree <a's tree with README.md changed> -p (a) -p <l1> -m innocent`. Then `merge console-01-a` succeeds.
  - The act reads `...; records at <recSha> in home, and earlier at <l1>`. merge never landed l1.
  - `metrics --json` then has no `merged-without-merge` at all, so both (a) and (b) are hidden.
- Control (withA=false): (b) alone, same steps. The act has no "earlier at", and `home:<b>` is flagged.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| B5-1 | Important | quality.md §3 (detector contract: a merge commit whose branch head no merge act names stays `merged-without-merge`; the act names only what merge landed, the contract B2-1, B3-1 and B4-1 enforced); plan T3b (the act names what the retry finished) | docs/devteam/scripts/devteam.mjs:5129 (`landedRecordsHeads`), act at :5438, detector at :11895 | `landedRecordsHeads` reads only git, and a faithful merge made by hand passes every check. A merge of any earlier records commit, made before merge ever runs, with subject `<id>: records`: the commit is not in p1, it is an ancestor of recSha, the merge changes only the ticket's folder, and its tree is git's own merge. So the act claims "and earlier at <l1>", which merge never landed. That push is itself a merged-without-merge: records reached home's main before any final review or merge check. Because l1 is now named, `heads.has(p2)` hides every other merge of l1 too, such as (b), which edits README.md outside every folder. No gate, review or check covered that change. This is B4-1's damage through a records-branch commit instead of an old main commit. It needs the same two hand pushes to main, and without the borrowed subject (b) stays flagged (control). The head can't be told apart from git alone, since subject, body and committer are all text anyone can write. Fix: make landRecords keep a record when it lands, for example a log entry with the ticket and the landed head (or the merge sha), appended before the code lands. Then have `landedRecordsHeads` name only heads recorded that way that are still on home's main. This would also clear B3-2's rewritten-branch case. Test: the probe above, (a) then (b), with neither named and both flagged after `merge`. | fixed: landRecords logs its own merge-word act naming the records sha as it lands (no refs: the ticket is not merged yet); landedRecordsHeads and its git inference are gone, so only what merge landed is named; test: a plain --no-ff merge of a real records commit pushed by hand stays flagged |

Other areas, no new finding:
- The setting off: `rec` is null, so `landedRecordsHeads` is never called and the act text is unchanged.
- A retry after home's ticket/<id> moved: the real first landing is still named (the branch's test covers this).
- Merge order across the two repos: the records land before the code, and the act is logged after both. A half-done retry with an unchanged head names recSha directly.

Verdict: CHANGES 5fdaa41a058ae6b898b3d03ff45fc5ab97646b72
