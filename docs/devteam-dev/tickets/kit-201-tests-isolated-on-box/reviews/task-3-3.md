# Task 3 review, pass 3

- Reviewer: confirmer-4 (fresh subagent, claude-opus)
- Reviewed: 248835412637023071cb2368c5d783088411078d

Read: reviews/task-3-2.md (T3b-1 and its disposition), and `git diff af0693e 2488354 -- docs/devteam/scripts/devteam.mjs test/`.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

None.

## T3b-1

Fixed. The one `execFileSync('git', ['rev-parse', …])` in the re-exec block now runs with an env that has `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR` and `GIT_INDEX_FILE` removed. Nothing else in the block changed. The test in `a kit takes a run folder inside its home…` runs `status` from home's worktree with `GIT_DIR=<main>/.git/worktrees/app-wt`, set from `git rev-parse --absolute-git-dir`, and asserts exit 0. I checked that the test goes red without the fix: in a scratch copy of 2488354 with only `env: scriptGit` removed, the test fails with the false message the pass-2 review described (`…/app-wt/docs/devteam/scripts/docs/devteam`).

## Does dropping the vars change which kit runs

No, not for a legitimate caller:
- A worktree whose `GIT_DIR` is its own gitdir: `--git-common-dir` gives the same `<main>/.git` with or without it, so the re-exec still goes to main's kit. Probed: the main kit was marked to print a line, and both the plain run and the `GIT_DIR` run re-exec'd main's kit.
- In a main checkout's hook, git sets no `GIT_DIR` (it was empty in the probe). A relative `GIT_DIR` used to make the call fail and skip the checks. Now it is ignored, and the block answers about the script's own repo. That is stricter, and correct.
- A caller whose `GIT_DIR` points at another repo used to send the re-exec to that repo's kit. Now the kit answers from its own checkout. That fixes a latent mis-route and breaks nothing.
- The spawned main kit inherits the full env and strips the same vars itself. Later git calls in the script still use the caller's `GIT_DIR` with the caller's cwd, as they did before this diff, and they are consistent in the hook and worktree cases.

## Other env

- `GIT_INDEX_FILE` (set by git to `index.lock` or `next-index-*.lock` for `commit -a` and partial commits) is stripped, and it does not affect `rev-parse` anyway.
- `GIT_CEILING_DIRECTORIES` and `GIT_DISCOVERY_ACROSS_FILESYSTEM` are not exported by git to hooks or to `rebase --exec`. At worst they make discovery fail, which nulls `top` and `common` and skips the checks (fails open, as for a kit in no repo). The inherited env behaved the same way before this diff. Not a finding.
- `GIT_CONFIG_PARAMETERS` (from an outer `git -c core.worktree=…`) could in theory move `--show-toplevel`. Git does not set it on its own, and nothing realistic sets that key. Not a finding.

## Runs

| Run | Result |
|---|---|
| here, via run-isolated.sh: machine, `run folder (outside\|inside)\|repo link\|copied into\|importing the test helper` | 5 pass, 0 fail, 17 skipped |
| scratch copy (git archive 2488354, own repo) with `env: scriptGit` removed, `run folder inside` via its own run-isolated.sh | FAILS: `not ok 4`, `with GIT_DIR: devteam: this kit … is not its checkout's own (…/app-wt/docs/devteam/scripts/docs/devteam)` |
| scratch project (kit from 2488354, `env -i`, temp HOME): `status` from a real pre-commit hook in a worktree with `commit -a`, in main with `commit -a`, in main with a partial commit; `git rebase --root --exec` in a worktree; `GIT_DIR` of an unrelated repo; `GIT_CEILING_DIRECTORIES` | all exit 0, no refusal; the worktree's runs re-exec main's kit |

All mutations and probes ran in fresh `mktemp -d` folders under my scratchpad (`c4-*`, `c4p-*`). No tracked file was changed.

Verdict: APPROVE 248835412637023071cb2368c5d783088411078d
