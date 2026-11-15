# Final review, pass 1

- Reviewer: final-reviewer 1 (fresh subagent, claude-opus-5-5)
- Reviewed: a72f45ab0e0dfd37e0e152c7c625e9448f7c351a (the whole branch)

I read the ticket, the spec, and the plan's Rulings (m-20261115-064239382-supervisor: worker and planner `--resume` also get the pointer, and RECOVER/LEGACY messages stay inline word for word). I read the whole branch diff in a detached tree at a72f45a. Outside the ticket's records, only two files changed, both modified: `docs/devteam/scripts/devteam.mjs` and `test/kit.test.mjs`. Every added file is under `docs/devteam-dev/tickets/kit-232-prompt-by-file/`.

I grepped `$(cat` and `promptFile` across the code:
- **Worker and planner launch (`makeSession`, ~15815):** now always types `shq(promptPointer(promptFile))`, fresh or resumed. The prompt file is still written by the unchanged `writeFileSync`.
- **`recoverOne` (~12705) and `legacyRecover` (~12922):** a fresh start (no session id) gets the pointer. A resume still gets `"$(cat …)"` of a file holding only RECOVER_MESSAGE or LEGACY_RECOVER_MESSAGE (plus the short missing-files note), so the argv is unchanged.
- **Usage-limit restart:** `SUPERVISOR_RESTART_PROMPT` (~12467) is inline and untouched.
- **Operator launch (~13346):** keeps `$(cat)`, which the spec explicitly puts out of scope.

The pointer:
- is plain words with no harness flag, so it works for any `agent_command`;
- takes an absolute path via `path.resolve`;
- is fully shell-quoted by `shq`, which escapes single quotes;
- reaches the in-place `recover --here` path too, since `run` goes through `sh -c` and stays correctly quoted.

I read, without running, the verbatim resume assertions in `test/recovery.test.mjs` (lines 328, 483, 633, 747) and `test/machine.test.mjs` (lines 624, 707–708). None depends on the changed fresh-start text. `machine.test.mjs:633` still matches, because the pointer names `supervisor-prompt.txt`.

I ran only the new test (`--test-name-pattern='short pointer to the prompt file'`, concurrency 2), and it passed. I then checked that it catches regressions by mutating the code, one change at a time:
- reverting the worker/planner line to `$(cat)`: the test fails ("the shell refused the agent's command line");
- reverting it for `--resume` only: the test fails;
- making the path relative: the test fails.

I restored the file after the mutations and removed the worktree. GitHub CI on #253 was still pending when I checked, so done-when 4 is not yet verified. I found no Critical or Important issue.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | quality.md §3 (test covers the change) | test/kit.test.mjs new test; devteam.mjs ~12705, ~12922 | The new test drives only a planner through `makeSession`. The supervisor fresh-start pointer in `recoverOne` and `legacyRecover` is covered only by `machine.test.mjs:633`, whose regex now matches the file name inside the pointer rather than the prompt's text, so its message "with its own kit's prompt" is proven more weakly than before. The code is correct; this is test depth only. The spec already accepts it (Out of scope, F5). | wont-fix the spec accepts code at the supervisor sites (spec review F5); their old-kit fixture is outside touches |
| F2 | Minor | done-when 4 | PR #253 checks | GitHub CI (build, kit 18/20/22/24 chain and rest) was pending at review time. The merge must wait for it to go green at a72f45a. | fixed: CI 8/8 success at a72f45a (run 43687186908, gate ci on the rerun); verification.md row 4 |

Verdict: APPROVE a72f45ab0e0dfd37e0e152c7c625e9448f7c351a
