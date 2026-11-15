# Final review, pass 2, track b

- Reviewer: final-reviewer-f2b (fresh subagent, claude-opus)
- Reviewed: 17034573c2aea962cb7a644ea20acac4b58cdeb3 (cold confirm of final-1b, adversarial)

I ran these probes against multiFixture in a private copy of the review checkout. These held. The ids console-01-a and console-01-ab: console-01-ab's half-done records merge isn't named by console-01-a's act and stays flagged, because the subject match is exact. A final record whose last `- Records:` line is stale and whose first is good is refused (B3). test/multirepo-home.test.mjs passes at this commit (12 of 12). With the `landedRecordsHeads` naming mutated away, the new B1 test fails. B5 is in its test and holds. With the setting unset, nothing calls `landedRecordsHeads` (only when `rec` is set), so the act text is unchanged.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| B2-1 | Important | quality.md §3 (detector contract: merged-without-merge flags "a merge commit whose branch head no merge act names"; a merge act names what merge checked); plan T3b | docs/devteam/scripts/devteam.mjs:5125 (`landedRecordsHeads`), act at :5433 | The B1 fix names every first-parent merge on home's main whose subject is `<id>: records`. It never checks that the head was a records head merge checked: not an ancestor of the pinned `rec.sha`, and no limit on what the merge changed. Scenario (probe PROBE1): a records-in-home ticket is ready. Someone pushes a hand-made `--no-ff` merge to home's main with subject `console-01-a: records` that merges an unchecked commit editing README.md. Before the merge, metrics flags `merged-without-merge home:<sha>`. `merge console-01-a` then succeeds. Its act reads `...; records at <H> in home, and earlier at <unchecked head>`, and the finding is gone for good. A worker's push to main is exactly what this detector exists to catch, and a subject string now hides it. The same happens when the records branch is reset back after a hand-merged edit to spec.md. Fix: name only landed heads that are ancestors of `rec.sha` (so the verdict-holds and footprint checks at `rec.sha` cover them), and whose merge changes only `tickets/<id>/`. Test that a forged-subject merge stays flagged. | |

Verdict: CHANGES 17034573c2aea962cb7a644ea20acac4b58cdeb3
