# Spec and plan review (scope change), pass 5

- Reviewer: confirmer-3 (fresh subagent, claude-opus)
- Reviewed: af0693e57e8d97d7d853beadeb90bd7f52e77416

Read: reviews/spec-6.md, and `git diff 4aefda1 af0693e` for spec.md, plan.md and pr-body.md, against the code in docs/devteam/scripts/devteam.mjs at af0693e (lines 38-56 and 473-484).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S7-1 | Minor | spec §7 ("from the same `git rev-parse` call that block already makes") | spec.md §7; plan Step 3b | The mechanism doesn't say that the `rev-parse` must ask about the script's location, apart from the caller's git env. As written it inherits `GIT_DIR`, and a kit run from a hook or `git rebase --exec` in a linked worktree is refused (task-3-2 T3b-1). When T3b-1 is fixed, add "run without the caller's `GIT_DIR`/`GIT_WORK_TREE`" and the worktree-with-`GIT_DIR` case to §7's tests and Step 3b. | fixed: §7 says the rev-parse drops the caller's git env, and the GIT_DIR case is tested |
| S7-2 | Minor | spec ↔ PR body agree | pr-body.md, "What changes", 4th bullet | It says "A kit copied into another checkout without a `.git` of its own dies". That is the superseded mechanism. The rule is now "a kit that isn't its checkout's own `docs/devteam`", which covers `<home>/vendor/kit` and a copy beside an empty `.git`. Reword it to match spec §7. | fixed: pr-body describes the real-path check |

Notes:

- S6-1: fixed. Spec §7 now conditions on the real path of `<top>/docs/devteam/scripts` not being the script's folder, with `<top>` from the block's existing `rev-parse` plus `--show-toplevel`. It lists the vendored copy, the nested copy and the empty-`.git` case, and the tests name all three. Plan Step 3b says the same and adds the two cases. The code matches: devteam.mjs:42 is one `execFileSync` returning `[common, top]`, and :47 compares real paths. The machine test covers `<home>/vendor/kit` and the empty `.git`. A mutation back to the `.git`-exists check fails that test (task-3-2).
- §6 additions match the code. The message prints `DEVTEAM_RUN` resolved as given (`runDir`, from `path.resolve`) and `mainRoot` as git reports it. An empty `DEVTEAM_RUN` is unset (`||` at :473, with the guard's truthy test at :481). Both are tested.
- No new Critical or Important issue in the spec or plan text. The GIT_DIR regression is a code defect against §7's stated intent, so it is recorded in task-3-2.

Verdict: APPROVE af0693e57e8d97d7d853beadeb90bd7f52e77416
