# Plan review, pass 2

- Reviewer: spec-plan-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: 1c04efc9963502a1ef8875628a94e26a0811ded2 (plan.md fixes)

Pass-1 findings:
- P1-1: confirmed fixed. `check-exit.sh` (T1 step 2) extracts the burner block between markers, uses `sleep 300` as the stand-in and stubs run.mjs and the summary. It covers load 0, load 2 green, load 2 red, a burner killed beforehand, and a failing summary, checking pids with `kill -0`. Review Focus 5 now points at it.
- P1-2: confirmed fixed. `red-r3.log` uses `timed out, near timeout (run 3)`, and `red-near.log` adds `failed (exit 1), near timeout (run 1)`. Both expect exit 1.
- P1-3: confirmed fixed, with one new inconsistency (P2-1). The proving run is on the last workflow commit before the removal, verification.md is committed before the final reviews, and the `git diff <removal>..HEAD -- .github/` check is in T3.
- P1-4: confirmed fixed. shellcheck v0.10.0 is pinned and sha256-checked beside actionlint, `-shellcheck <path>` is passed, and `check-inputs.sh` scans every `run:` block for `${{`, the summary heredoc included.
- P1-5: confirmed fixed. `05`, `08` and an embedded newline are in the rejected cases. The TL;DR states the exact patterns.
- P1-6: confirmed fixed. Step 3 item 5 puts `rc=${PIPESTATUS[0]}` on the line right after the pipeline (under `set +e`), and item 8 exits with `rc` when it is non-zero, else with the summary's status.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Minor | done-when 4, P1-3 | plan.md:122 (T3 step 3) | T3 step 3 makes the removal commit contain "nothing else" and says "`git show --stat` shows only the workflow". It then says to fill in verification.md's final-head rows "in the same commit", which puts a second file in that commit. A row can't record the sha of the commit it lands in, either. Pick one. Either fill the final-head rows in a separate commit just before the removal (the removal changes only the trigger lines, so actionlint at that commit holds), or allow verification.md in the removal commit and drop the "only the workflow" check. Then make spec check 4 say the same. | fixed |

The fixes keep the TL;DR in step with the tasks. They add no new Critical or Important problem.

Verdict: APPROVE 1c04efc9963502a1ef8875628a94e26a0811ded2
