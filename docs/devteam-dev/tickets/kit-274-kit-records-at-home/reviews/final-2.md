# Final review: kit-274 kit records at home (pass 2a)

- Reviewer: kit-274 final reviewer 1a (fresh subagent of the supervisor, not the author; model claude-opus-5-5)
- Reviewed: fe586577f682688912e9c1715a79979740db4759

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

No findings at this head.

## What I checked

This re-review covers the changes since ca6bbcb7. My pass-1 findings were F1 (Important), F2 (Minor) and F3 (Minor). Per my brief, I did not read the other reviewer's record. The coordinator said its F1–F4 were fixed and F5 is wont-fix, and I did not verify those.

What changed since ca6bbcb7:
- docs/devteam/scripts/devteam.mjs is unchanged. `git diff --name-only ca6bbcb7 HEAD -- docs/devteam/scripts` is empty.
- The changes are:
  - test/multirepo-home.test.mjs: cases console-07-g and console-08-h in the left-in-link test, plus one new test, 'a link left on records "repo" (the default) never reads as left in the link';
  - the worker.md §1 wording;
  - the ticket's records: spec.md, verification.md, and the final-1 and final-1b records;
  - cloud/Dockerfile, from merging origin/main (f8c7e5ff). It is not part of the PR's diff against main.
- The only commit after the code head f896eb38 changes verification.md.
- My final-1 record in the ticket folder matches what I wrote, apart from the filled Disposition cells.

Mutations, re-run on devteam.mjs at this head. Each run used `--test-name-pattern 'left in the link'`, which selects the left-in-link test and the new default test, under the shared flock. Each mutation was restored with `git checkout --`, and the worktree was clean after each.

| Id | Mutation | Result |
|---|---|---|
| (baseline) | none | exit 0, 2/2 pass |
| M8 | the home-wins check ignores home's main | caught at test line 484: console-07-g, check-ticket no longer refuses the link folder. **F1 fixed.** |
| M11 | `recordsHomeSetting` returns true for every link ticket | caught at test line 511: the new repo-default test. **F3 fixed.** |
| M12 | merge decides in the views form (no `at: sha`) | caught at test line 492: console-08-h, merge --dry-run with the link's local `ticket/<id>` reset to trunk. **F2 fixed.** |
| M16 | `check-pr --repo` decides in the views form (no `at: sha`) | caught at test line 495: console-08-h check-pr. |

Pass-1 mutations M1–M7, M9, M10 and M13–M15 were all caught at ca6bbcb7. The code they mutate is byte-identical here, and the tests that caught them are unchanged apart from the additions.

Nothing new broke:
- My local runs of the rest of the file could not get the shared lock within the per-command time limit, so I used CI at this exact head.
- In job "kit (22, rest 1/2)" (133875132380), test/multirepo-home.test.mjs ran 15/15 ok, including tests 9 and 10.
- At fe586577, every kit job passes except "kit (22, rest 2/2)". It fails test/machine.box.test.mjs "the minute loop brings back a lost tmux server…" with `the loop never waits on the lock`. That file isn't touched by this PR, the same test passes on node 18, 20 and 24, and the PR's diff against main doesn't reach machine/box code, so I read it as a timing flake outside this change.
- The aggregate "tests" check fails because of that one job. Merge needs it green, so it should be re-run.

worker.md §1 now says records go in home only when the link sets `records: "home"` and the prompt names a checkout of home's `ticket/<id>`, and that a ticket begun before the switch keeps them in the repo, as its prompt says. This matches promptFor. The home records line is given only when `recordsInHomeId(id)` holds (views form). A left-in-link ticket gets the default line, `keep this ticket's records under <project>/tickets/<id>/ in this repo.`, which A7 asserts. worker.md is a process doc, so the supervisor still owes governance-edit before merge.

The gate, as in pass 1: left in the link reads everything from the link at the head, holds verdicts to the link head, and keeps two-reviewer approval. Home wins on any of main, local `ticket/<id>` or origin `ticket/<id>`, and every one of the three is now tested. Records in both places are refused, and the main-only case is now tested. Each command decides once, at the head, and merge and check-pr --repo are now tested for it. Repo-mode tickets are untouched, now tested with no warning and no home routing.

Kit rules and the superpowers deletion, re-checked at fe586577:
- `git ls-tree -r HEAD -- docs/superpowers` lists 0 files.
- `git merge-tree --write-tree origin/main HEAD` is clean (tree 371bbff7).
- `--diff-filter=A` adds files only under `docs/devteam-dev/tickets/kit-274-kit-records-at-home/`.
- The changed files are all in touches.
- The PR head is fe586577 and its body has `## One-way doors`.
- The 35 superpowers blobs were already shown identical to devteam-dev main in pass 1, and no superpowers file changed since.

Process: every command ran in the foreground under 170s. The flock wait was capped with `-w` and node with `timeout`. There were no background jobs and no orphans; I checked with pgrep at the end.

Verdict: APPROVE fe586577f682688912e9c1715a79979740db4759
