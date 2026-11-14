# Task 3 review, pass 2

- Reviewer: confirmer-3 (fresh subagent, claude-opus)
- Reviewed: af0693e57e8d97d7d853beadeb90bd7f52e77416

Read: reviews/task-3.md, and `git diff 4aefda1 af0693e` for docs/devteam/scripts/devteam.mjs (the re-exec block, `runDir`) and test/machine.test.mjs.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T3b-1 | Important | spec §7 (dies only when "the copy isn't its checkout's own `docs/devteam`"); spec §6 Must not break (a worker in home's worktree) | docs/devteam/scripts/devteam.mjs:42,47 | The combined `git rev-parse` inherits the caller's env. Git exports an absolute `GIT_DIR`, with no `GIT_WORK_TREE`, to hooks run in a linked worktree and to `git rebase --exec`. With `GIT_DIR` set that way, git takes the cwd as the work tree. The cwd here is the script's own folder, so `--show-toplevel` returns `<kit>/scripts`. The kit then compares `<kit>/scripts/docs/devteam/scripts` with `<kit>/scripts` and refuses every command. The message is false: it says the kit "is not its checkout's own (`<…>/scripts/docs/devteam`)". Probe: scratch repos of 4aefda1 and af0693e, each with a worktree, ran `node docs/devteam/scripts/devteam.mjs status` from a pre-commit hook in the worktree. The old kit resolved its main checkout as before. The new one died with that message. The same happens with `GIT_DIR=<repo>/.git` set by hand, from the repo root or a subfolder. `git rebase --exec` in a worktree was confirmed to export `GIT_DIR`. The old `.git`-exists check passed in every one of these cases, so this is new in this diff. It fails closed, so nothing is written, but a legitimate worker setup (a gate or test run from a hook or `rebase --exec` in a worktree) breaks, with a misleading message. Fix: run this one `execFileSync` with `GIT_DIR`, `GIT_WORK_TREE` and `GIT_COMMON_DIR` (and `GIT_INDEX_FILE`) removed from its env, since the block asks where the script lives, not where the caller's git points. Add a test: `status` from a worktree with `GIT_DIR=<main>/.git/worktrees/<wt>` exits 0. | fixed: the rev-parse runs without GIT_DIR, GIT_WORK_TREE, GIT_COMMON_DIR, GIT_INDEX_FILE; a worktree with GIT_DIR set is tested (red before, green after) |

## T3-1..T3-5

- T3-1: fixed. `runDir` uses `||`, so `DEVTEAM_RUN=''` falls back to `<mainRoot>/docs/devteam/run`, and the guard (truthy test) skips it consistently. The test runs `observe` from inside app-api's run folder with `DEVTEAM_RUN=''` and finds the line in app's own run log.
- T3-2: fixed. The check compares `real(<top>/docs/devteam/scripts)` with `real(dirname(self))`. `self` comes from `import.meta.url`, which Node has already resolved through symlinks. The test adds `<home>/vendor/kit` (status refused) and an empty `.git` beside the nested copy (status and observe refused, home's run unchanged).
- T3-3: fixed. `help`, `machine status` and `operator-thread list` are asserted not refused with a leaked `DEVTEAM_RUN`. `recover --machine` is still untested here, which is acceptable: the reviewer probed it by hand, and it touches the real account.
- T3-4: fixed. The worktree case runs `phase spec`, `status` and `observe`, and asserts both lines in home's run. `app-ln` runs `status`.
- T3-5: wont-fix accepted. It is outside the spec, and gateway's fixtures `git init`.

## The combined rev-parse and `common`

`common` is now null whenever `--show-toplevel` fails, which is wider than before, when only `--git-common-dir` had to succeed. `--show-toplevel` fails (exit 128) only where there is no work tree: inside a `.git` folder, or in a bare repo. A runnable kit is a file in a work tree, so neither case happens for a real kit. A relative `GIT_DIR` (resolved against the script folder) made both old and new fail the call, so they skipped alike. The exposure that remains comes from the inherited env (T3b-1), not from `common` going null. The box image (`/opt/devteam/kit`, no repo) still skips the check. A kit repo used as a submodule at `<home>/docs/devteam` still passes, because its top level is the submodule's own.

## Runs

| Run | Result |
|---|---|
| here, via run-isolated.sh: machine, `run folder (outside\|inside)\|repo link\|copied into\|importing the test helper` | 5 pass, 0 fail, 17 skipped |
| scratch copy `c3-revert` (git archive af0693e, own repo): the nested check reverted to `!fs.existsSync(<script>/../../../.git)`, then `copied into` via its own run-isolated.sh | FAILS: `not ok 6`, `'a vendored copy'` (status exited 0) |

The probes ran with `env -i` (PATH, a temp HOME) against scratch copies under my scratchpad only. Note: the scratchpad is shared with earlier reviewers. My first `git archive` + `git init` landed by mistake in an existing `scratchpad/mut` folder, which overwrote that folder's tracked-file copies and made it a repo. It was a scratch folder, not tracked here, and I used it for nothing else.

Verdict: CHANGES af0693e57e8d97d7d853beadeb90bd7f52e77416
