# Final review, pass 3, track b

- Reviewer: final-reviewer-g3b (fresh subagent, claude-opus)
- Reviewed: ecbcbfa4bbca4d355b153102f7e5752aec9ac7c1 (cold confirm of final-2b, adversarial)

I ran these probes as extra tests in a private copy of the review checkout. Each probe followed a half-done merge (console's origin refuses one push), and then the records branch moved (l1, l2, l3 = recSha). I crafted hand-made merges with `git commit-tree` and pushed them to home's main, all with the subject `console-01-a: records`.

These held:
- A: p2 = an older records commit that is an ancestor of recSha, with a README.md edit. It is not named and stays flagged, so `changedFiles(p1, m)` catches an edit outside the folder.
- C: an octopus merge. It is not named and stays flagged.
- E: an edit under the lookalike folder `tickets/console-01-ax/`. It is not named and stays flagged.

With `records` unset, nothing calls `landedRecordsHeads`, because `rec` is null, so the act text is unchanged.

Two probes went wrong: B (B3-1) and the rewritten-branch case (B3-2).

An observation outside this ticket's scope, not a finding: probe D was a forged merge whose p2 is the half-done landing's own head (r.head), with a README.md edit. It is hidden, because the detector checks only whether a merge's p2 is named. A merge act already names that head legitimately. The same is true today of any named code head, and the spec's contract ("a merge commit whose branch head no merge act names") allows it.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| B3-1 | Important | quality.md §3 (detector contract: a merge no merge act made stays merged-without-merge; the act names what merge landed); B2-1's fix contract ("so those checks covered it") | docs/devteam/scripts/devteam.mjs:5133 (`landedRecordsHeads`), act at :5436 | The fix checks that a merge changed nothing outside `tickets/<id>/`. It never checks what the merge put inside that folder, so a hand-made merge that adds unchecked records is named and hidden. Probe B: after the half-done merge, records head l1 is pushed to home's ticket/<id>. Then l2 and l3 are pushed. Someone pushes a hand-made merge to home's main, with subject `console-01-a: records`, parents (main, l1), and a tree that also adds `tickets/console-01-a/reviews/final-9.md` (a forged APPROVE that is in no records commit). l1 is an ancestor of recSha (l3), and every changed file is under the folder, so the filter passes. The retry's act reads `...; records at <l3> in home, and earlier at <l1>, ...`, but merge never landed l1. The hand-made merge (9fab64a… in the probe) drops out of `merged-without-merge`, and the forged review stays on home's main in the ticket's records, which no check covered. A merge that edits spec.md or verification.md in the folder behaves the same way. Fix: name a head only when the merge's tree is exactly what merging it gives, for example `mergeTree(p1, h)` equals `m^{tree}`, or no diff between h and m under `tickets/<id>/`. Add a test where an in-folder forged merge of an ancestor head stays flagged. | fixed: a head is named only when its merge's tree is exactly git's own merge of its parents (mergeTree(p1, h) = m^{tree}); test: an in-folder evil merge (a real records commit plus a forged final-9.md) is not named and stays flagged |
| B3-2 | Minor | plan T3b ("Once the retry lands the code, the act names the records sha and all three go away") | docs/devteam/scripts/devteam.mjs:5133 | When the records branch is rewritten after a half-done merge, the first landing stays flagged for good. Probe: after the half-done merge, the author amends the final records commit to add `reviews/task-9.md` and force-pushes home's ticket/<id>. The retry lands it and logs the act with no "earlier at". The first records merge was made and checked by merge itself, but it is not an ancestor of the new recSha, so it is not named. metrics then keeps a high `merged-without-merge home:<sha>` that says "no gates, reviews or checks ran on it", which is false, and nothing clears it. Before 8298e95 this case cleared. The comment accepts this ("any other merge stays merged-without-merge"), which is why this is Minor. A record made when merge lands the records (for example the landed head in a log entry, which the retry's act cites) would name it without trusting a subject. | wont-fix: rewriting a records branch after it landed is outside the flow (records are append-only once reviewed); the finding then says what is true of that commit as merge sees it, and the supervisor reads it. Naming a non-ancestor head would let a stale or forged landing hide, which B2-1 closed |

Verdict: CHANGES ecbcbfa4bbca4d355b153102f7e5752aec9ac7c1
