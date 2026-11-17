# kit-172 plan review 3

- Reviewer: fresh subagent (opus), not the author

I read the plan at 44e4c754, the diff from 104fa259, `reviews/plan-1.md` and `reviews/plan-2.md`, the approved spec, `quality.md` §3 and §6, and `worker.md` §3–§4. I also read `landArtifact` (dashboard.test.mjs 395). In a private scratch repo I ran the plan's exact `git log --format=%x01%H %cI --raw --no-abbrev -t -m --first-parent --no-renames HEAD -- a/b/vm` over this history: v1, an unrelated commit, v2 (which adds `a/b/vm/img/a.svg`), and v3.

The P2 findings:

- **P2-1 is fixed in its premise, though the test is weaker than the plan says** (P3-1). Review Focus 5 now says that the pathspec keeps siblings out of `--raw`, and that the exact match guards against the folder's own subfolders and its parents. That is correct. On v2's commit the scratch run printed `:000000 040000 0000… 415abf7a… A	a/b/vm/img`, after the `a`, `a/b` and `a/b/vm` lines. `rev-parse <v2>:a/b/vm/img` gave the same `415abf7a…`. So a `040000` line for the subfolder really does reach the parse.
- **P2-2 is fixed.** A2 now stages with `F.g(['add','-A'], wt)` before the commit that has the identity flags.

The rest of the plan is unchanged from pass 2 and still holds: the TL;DR matches the tasks; the files stay inside the touches; each task has its Model line, the failing test first and the expected failure; A1–A7 carry the spec's assertions; M1–M6 each turn their named test red; and the counts are 5, then 7. Since `landArtifact` writes files and never removes any, v3 keeps `img/` unchanged. v3's commit therefore has no `img` line, and A1's three expected trees stay as the plan says.

I ran no tests.

| ID | Severity | Rule/spec cited | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P3-1 | Minor | quality.md §3 ("Where a test can't prove a property, mutate the code … and check a test fails") | plan Review Focus 5 ("a prefix parse would give a fourth entry or the wrong tree"); T1 A1 parenthetical | A1 catches only one kind of prefix parse, not every kind. git prints the folder's own line before its children's (the scratch run shows `a/b/vm`, then `a/b/vm/img`). So a `find` with `startsWith(folder)` still picks the folder's line first and gets the right tree. It behaves the same as `===` and passes A1. A parse that collects every `040000` line under the folder does add `img`'s tree, but `img/` has no `artifact.json`, so the `cat-file` filter in Step 3 drops it. That leaves 3 entries, and A1 passes again. Only a "last match wins" parse, which takes `img`'s tree as v2's, goes red (v2 is then filtered out, leaving 2 entries). No plausible wrong parse ships a wrong list, so this blocks nothing. Fix, if the author wants the claim to hold: reword Review Focus 5 to say that A1 catches a last-match prefix parse, and that the `artifact.json` filter covers the collect-all one. Or add a mutation M7 (the parse keeps the last `040000` line whose path starts with the folder), which turns A1 red. | |

Verdict: APPROVE 44e4c7543a6888a92aaadd45d2c66fa825b68d8f
