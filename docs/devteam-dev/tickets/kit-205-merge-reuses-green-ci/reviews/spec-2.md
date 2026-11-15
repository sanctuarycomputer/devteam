# Spec review, pass 2

- Reviewer: spec-reviewer-2 (fresh subagent, claude-opus-5-5, cold confirm)
- Reviewed: 1264243a3c7168ca2b09769e730b5175777989b5 (spec.md, diff since 988956d)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | strategy P6 (stop the accidental path); done-when 2 | spec "The change" step 2 (the `.github/` rule) | The new step 2 says what happens when the PR changes a file under `.github/` between the merge base and `sha`. It does not say what happens when merge can't tell. Today's code computes the base as `R.mainRef() ? R.git(['merge-base', R.mainRef(), sha]) : null` (devteam.mjs ~L5063 and ~L5138), so `base` can be null, and the diff itself can fail. If the implementation treats "no diff" as "no `.github/` change", the gate is skipped exactly when merge can't see what the PR changed. Step 3 already handles its own failure the safe way ("If that call fails … no gate is covered"). Fix: add one clause to step 2: if the merge base or the diff can't be computed, nothing is covered and merge says why. The plan's D2 tests could add that case. This isn't blocking, because the plan can pin it. | |
| F2-2 | Suggestion | readability | spec "Edge cases" | The two new bullets (truncation, `show release`) come before the old list, with a blank line between them. That breaks the section into two lists. Merge them into one list. | |

**F1-1: confirmed fixed.** In "The change" 4, `"ci"` now needs every entry to be SUCCESS. It says outright that a SKIPPED or NEUTRAL entry means not covered, and it keeps ignored_checks in the set. Out of scope names, in one line, that `"ci"` can't see a check that never reported, and says the list form can. D2 adds the case "SUCCESS plus SKIPPED for `"ci"`".

**F1-2: confirmed fixed.** The new step 2 refuses coverage when any file under `.github/` changed between the merge base and `sha`, and merge says why. It gives the `pull_request` workflow reason and cites R1. D2 adds the case "the PR changes a file under `.github/`". The rule can be built with what merge already has: `R.git` merge-base is used at ~L5063 and ~L5138, and the worktree is at `sha`. One fail-open gap is left, F2-1 (Minor).

**F1-3: confirmed fixed.** The Docs section names quality.md L24 and L121 and supervisor.md L127, with the clause to add to each, and records the ask as m-20261115-204658302. The **Modes** paragraph is tied to grant m-20261115-204545585, which the Rulings now record. "Recommended in quality.md" now points at a file in `touches`. The three-line edit still waits on that ruling, which is the right state for a spec.

**F1-4: confirmed fixed.** D2 now says the pending and failed cases come from a green first read followed by a re-read that differs, from a fake gh answering the second `pr view` otherwise. That makes them reachable past today's check at the first read (~L4997-5010). D1 names a real, not dry, sibling-ticket merge on a `multiFixture` as the vehicle. I checked the precedent: `test/multirepo-landing.test.mjs:89` does a real `merge console-01-a`, and the `gate-sibling` fixture at L147 shows gates on a sibling.

**F1-5: confirmed fixed.** "The change" 4 sets out one shared helper and its rules: StatusContext or `state` is judged by `state`; a CheckRun counts as complete only when `status` is COMPLETED and is then judged by `conclusion`; values are uppercased; anything else is pending. This matches today's line in cmdMerge exactly (`c.__typename === 'StatusContext' || c.state ? … : (c.status === 'COMPLETED' ? … : 'PENDING')`, ~L5004).

**F1-6: confirmed fixed.** Step 3 re-reads by `pr.number`, and also treats unparseable output as a failure. Edge cases notes that the rollup can be cut short, says the list form stays safe, and says quality.md prefers the list form.

**F1-7: confirmed fixed.** Edge cases now says `show release` lists only gates that ran, says the act's `what` names the covered ones, and says the view is unchanged.

The diff adds no new Critical or Important problem. The steps were renumbered from 1-5 to 1-6, and the cross-references inside the spec stay consistent.

Verdict: APPROVE 1264243a3c7168ca2b09769e730b5175777989b5
