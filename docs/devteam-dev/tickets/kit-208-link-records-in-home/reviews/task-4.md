# Task review, T4

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus)
- Reviewed: 7ced60b3a91229a92ba413101c7400f0819dd602 (T4: worker, prompt, review-worktree, remove, tidy, approve-plan, timeline)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T4-1 | Minor | spec acceptance 1 ("the tidy removes a `records-<id>` worktree on the same terms as the ticket's own") | docs/devteam/scripts/devteam.mjs:16058-16062 | The tidy rule for `records-<id>` has no test; removing the branch would pass the suite. The plan's T4 test list doesn't ask for one, so this is not blocking, but the rule is unguarded. | |
| T4-2 | Minor | quality.md §3 (review-worktree "removes only what it made") | docs/devteam/scripts/devteam.mjs:4771-4772 | `--remove` force-removes `<at>-records` whenever it is any home worktree. Unlike `at`, it doesn't check that this is a detached checkout listed in home's worktrees. A home worktree that happens to have that name (another `--name` choice) would lose uncommitted work. Unlikely given the naming; checking `detached` in home's worktree list would close it. | |
| T4-3 | Minor | spec acceptance 1 (prompt: "when home's forge isn't `git`, also open a home PR …") | docs/devteam/scripts/devteam.mjs:15563 (promptFor) | The forge≠git sentence of the records prompt is untested (the fixture's home forge is git), and it reads `loadSettings().forge` where the spec says home's forge is `repo('home').settings.forge` (the same value in practice). | |

Checked: ensureRecordsWorktree in makeSession runs on its own (a resume whose records worktree was removed gets it back) and follows the order local branch, then origin tracked, then new from home's origin/<main>, unseeded; the default prompt tail is byte-identical (`${head}, and keep this ticket's records … in this repo.`); review-worktree prints `records: <path> (<full sha>)`, and --remove removes both (asserted); removeWorkerWorktree removes `records-<id>` through home and prunes (asserted after merge and phase done); timeline reads home's ticket/<id> before the merge and home's main after it, with no `repo` field (asserted); approve-plan moved to T1. The tmux-guarded worker launch ran here (tmux 3.3a). Test file passes (11/11, exit 0).

Verdict: APPROVE 7ced60b3a91229a92ba413101c7400f0819dd602
