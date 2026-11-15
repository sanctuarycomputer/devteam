# Final review, pass 4, track b

- Reviewer: final-reviewer-f4b (fresh subagent, claude-opus)
- Reviewed: b3154dcfa6f8fc3b795df65438bb82e6cae44940 (cold confirm of final-3b, adversarial)

The B3-1 fix holds for the case it was written for. An in-folder evil merge whose tree differs from git's own merge of its parents is no longer named. I added an extra test to a private copy of the review checkout and ran it on its own (`node --test --test-name-pattern`). It shows that `landedRecordsHeads` still names a head that `landRecords` never merged: an old commit on home's main. Because metrics exempts any merge whose second parent an act names, that naming then hides an unrelated evil merge.

Probe: `console-02-b` is set up as a records-in-home ticket with approved spec and plan and a reviewed records head. Before `merge`, someone pushes two hand-made commits to home's main. (a) `git commit-tree main^{tree} -p main -p <old1> -m "console-02-b: records"`, where old1 is a home main commit before the records branch's base. It is an empty merge: its tree is main's. (b) `git commit-tree <tree with README.md changed> -p (a) -p <old1> -m innocent`, an evil merge outside any records folder. Then `merge console-02-b` runs.

- Result: the act reads `...; records at <recSha> in home, and earlier at <old1>`, and `metrics --json` has no `merged-without-merge` at all: both (a) and (b) are hidden.
- Control: the same probe with (a)'s subject changed to `not records`. The act has no "earlier at", and both merges are flagged (`home:<b>`, `home:<a>`).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| B4-1 | Important | quality.md §3 (detector contract: a merge commit whose branch head no merge act names stays `merged-without-merge`; the act names only what merge landed, as with B2-1 and B3-1) | docs/devteam/scripts/devteam.mjs:5134 (`landedRecordsHeads`), act at :5437, detector at :11895 | Every check passes for a merge whose second parent h is already in its first parent's history. Any home main commit before the records branch's base is an ancestor of recSha. git's merge of p1 and h is p1's tree, so the tree check and the folder check (nothing changed) pass trivially. So a hand-made empty `<id>: records` merge of any old main commit makes the act claim "earlier at <old1>", which merge never landed. The detector exempts every merge whose p2 is named (`heads.has(p2)`), so any other hand-made merge with that same old commit as p2 is also hidden, including one that edits files outside every folder (README.md in the probe), which no gate, review or check covered. Without the records subject, both are flagged (control). Fix: a head counts only if it was not yet on main when merged, e.g. add `ancestorOf(h, p1) === false` (a `merge --no-ff` that `landRecords` makes always brings in a head that p1 lacks). Add a test: an empty `<id>: records` merge of an old main commit, plus a second merge of the same p2, are not named and both stay flagged. | |

Other areas I checked, which turned up no new finding beyond B4-1:
- the setting off: when `records` is unset or "repo", `rec` is null and `landedRecordsHeads` is never called.
- I did not re-probe the octopus, lookalike-folder and footprint cases. final-3b probed them and the branch's tests cover them.

Verdict: CHANGES b3154dcfa6f8fc3b795df65438bb82e6cae44940
