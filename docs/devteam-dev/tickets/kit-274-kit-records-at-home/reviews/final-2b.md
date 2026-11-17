# Final review: kit-274 kit records at home (pass 2b)

- Reviewer: kit-274 final reviewer 1b (fresh subagent of the supervisor, not the author; model Fable 5.2, claude-fable-5-2)
- Reviewed: fe586577f682688912e9c1715a79979740db4759

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | merge's forge checks at the head (a failing check fails the merge) | PR #319 checks at fe586577, run 44034847139, job "kit (22, rest 2/2)" | The PR's checks are red at this head: `test/machine.box.test.mjs` failed ("the minute loop brings back a lost tmux server as a boot does …"), and the `tests` roll-up with it. The other 16 jobs pass. This commit changes only verification.md, and the run at the code head f896eb38 (44034160823) was all green, so it reads as a flake outside this change; I did not rerun it (read-only gh). `merge` will refuse until that job is rerun green. | fixed: the supervisor reran the failed job of run 44034847139 (m-20261117-073840169); the merge waits for every check green at the new head |

No Critical, no Important.

## What I checked

**What changed since ca6bbcb7.** `docs/devteam/scripts/devteam.mjs` is byte-identical to pass 1 (no diff). The changes are: worker.md line 9, 37 added lines in test/multirepo-home.test.mjs, spec.md, verification.md, the two pass-1 review records added (my final-1b as I wrote it, only its five Disposition cells filled), and cloud/Dockerfile from the merge of main. f896eb38..fe586577 changes verification.md only.

**My pass-1 findings.**

- F1 (merge and check-pr decide at the PR head): fixed. Case console-08-h resets the link's local `ticket/<id>` to trunk, then asserts `merge --dry-run` and `check-pr --repo` pass from the PR head with the warning once. Both mutations rerun: merge by the views form, **caught** (line 492: outside touches, no records in home); check-pr by the views form, **caught** (line 495).
- F2 (home's main alone wins): fixed. Case console-07-g commits a records folder on home's main only, then asserts check-ticket and `merge --dry-run` refuse the link folder, with no warning. Mutation rerun (home-main line deleted): **caught** (line 484: check-ticket said ok).
- F3 (worker.md): fixed. Line 9 now makes the prompt the condition ("and your prompt names a checkout of home's `ticket/<id>`") and says a ticket begun before the switch keeps its records in that repo, as its prompt says. This matches promptFor and ensureRecordsWorktree. Still one sentence.
- F4 (spec path and count): fixed. Rulings Q5 and A9 name `docs/devteam/project/designs/superpowers/` and 35 files; the Problem's count is 20 plans and 15 specs.
- F5 (the rule has no end): wont-fix, and I agree. It is the rule as ruled (Q2), every check still runs on those records at the link head, and the rollout check (`git ls-tree origin/main -- docs/devteam-dev` in the kit, empty) does catch a folder that comes back. It stays a thing for the supervisor to watch after the flip, not a defect of this PR.

**The other reviewer's findings** (final-1.md, CHANGES at ca6bbcb7): F1 is my F2 (console-07-g), F2 is my F1 (console-08-h), both verified above. F3 (the default not pinned in this file): the new test 'a link left on records "repo" (the default) never reads as left in the link' asserts no warning, no `no records … in home`, no outside-touches refusal for a default-link ticket with records in the link. Mutation (`recordsHomeSetting` always true): **caught** (line 511: the warning printed). All three have dispositions.

**Tests at the head** (test/multirepo-home.test.mjs only, under the shared lock, each run foreground and under 170 s, split by `--test-name-pattern`): the two changed/new tests pass (2/2); the setting, check-ticket and merge tests pass (3/3); the GitHub-home, worker, parked, half-done and hand-made tests pass (5/5). The first five tests of the file (fixture, sibling worker, kit copy, repo(), lines) I could not rerun here: the lock was busy on eight tries and the one run that got it timed out at 78 s under load. They don't touch records, devteam.mjs is unchanged since pass 1 where I ran them green, and CI ran the whole file green at f896eb38. Worktree clean at fe586577 after every mutation; no process of mine left running.

**Nothing new broke.** Added files against origin/main: only this ticket's records folder. Changed outside it: worker.md, devteam.mjs, test/multirepo-home.test.mjs and the docs/superpowers deletions, all in touches. docs/superpowers is empty at the head, and all 35 blobs still match devteam-dev `origin/main:docs/devteam/project/designs/superpowers/` (0 mismatched). The PR body has `## One-way doors`. Verification has a row per done-when and a note for this pass naming the code head. The gate attacks of pass 1 stand: the code they ran against has not changed.

Verdict: APPROVE fe586577f682688912e9c1715a79979740db4759
