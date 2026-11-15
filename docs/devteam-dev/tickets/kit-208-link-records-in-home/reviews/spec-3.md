# Spec review, pass 3

- Reviewer: reviewer-sp3 (fresh subagent, claude-opus)
- Reviewed: 27442e22ab84789f83bc00cf27f51cd8a00ea9c7 (spec.md, cold confirm of spec-2, diff fbffc90..27442e2)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F3-1 | Minor | spec-2 F2-2 | spec.md lines 77-81; devteam.mjs sessionSettled 3745-3757, fleet status 16389-16404 | The settled rule covers a records branch that exists locally with no commit of its own (no origin branch, local head in home's main). It doesn't cover the case spec-2 also named: no local `ticket/<id>` in home at all (the records worktree was never made, or was removed along with its branch). Today's rule needs `remote` to exist (3755), so read literally that session never settles. The spec should say that no local branch and no origin branch counts as pushed too: nothing to lose. | |
| F3-2 | Minor | spec-2 F2-1 (3) | spec.md lines 103-109 | "Any head when the branch is gone" doesn't say how merge knows the branch is gone. `git fetch origin ticket/<id>` against a deleted branch fails and leaves the old `refs/remotes/origin/ticket/<id>`, so a leftover tracking ref can look like a "fetched ref". The spec should say gone means the fetch (or `ls-remote`) finds no `ticket/<id>` on home's origin, whatever tracking ref is left locally. In normal use the leftover ref equals the PR head that merge landed (`--match-head-commit`), so this is a precision gap, not a stranding path. | |

Spec-2 findings confirmed fixed:

- F2-1: acceptance 3 now recognizes landed records per home's forge. For forge `git` the pinned sha is an ancestor of home's main. Otherwise merge takes the newest merged home PR (`gh pr list --head ticket/<id> --state merged`) whose head is the fetched ref, or any head when the branch is gone, and fetches that head from `refs/pull/<n>/head`. That covers squash and rebase merges (the sha is never an ancestor), a deleted head branch, and the merged-not-open PR, which no longer meets the open-PR refusals ("then the open-PR checks … don't apply"). The records are still checked at that sha, so P5's check isn't weakened. A reopened ticket whose branch has moved past every merged head goes back to the open-PR path. The test list adds the gh-stub GitHub case. I checked the verdict-holds path on the rerun: when the pinned sha is in home's main, `verdictHolds`' `^main` exclusion and its three-dot own-diff both come out empty, and the records footprint by merge-base is empty, so the rerun passes checks it should pass.
- F2-2: "a records branch that has no commit of its own yet (no origin branch, and its local head is in home's main) counts as pushed". This fixes the fresh-branch case. F3-1 is the leftover absent-branch case.

No new Critical or Important. Strategy: P2 unchanged (the setting is generic). P5: I tried to break the new landed-records path (any merged PR head when the branch is gone, a stale tracking ref, squash), and the records are always re-checked at the sha that is used. P6 section unchanged and still true. R1: the records footprint still holds on the rerun path.

Verdict: APPROVE 27442e22ab84789f83bc00cf27f51cd8a00ea9c7
