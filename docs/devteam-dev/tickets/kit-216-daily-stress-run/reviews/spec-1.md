# Spec review, pass 1

- Reviewer: spec-plan-reviewer-1 (fresh subagent, claude-opus-5-5)
- Reviewed: d499577ae29fcf95bb00c6968b1a0fce62d564ba (spec.md)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1-1 | Important | done-when 1, done-when 3 | spec.md:37 (Design step 3, burners and trap) | The trap is specified only as "`kill` on the recorded pids". Under the `set -euo pipefail` the design implies (plan.md:73), a failing command in an EXIT trap replaces the script's exit status. Checked here in a scratch bash script: with an empty pid list, `trap 'kill "${PIDS[@]}"' EXIT; exit 0` exits 2 (`kill: usage`). With an already-dead pid it exits 1. The scheduled run uses `load=0`, so as written every daily run on main goes red while every test is ok. The branch run (load=2) would never show it. The spec has to say that the trap leaves the step's status alone: skip `kill` when there are no pids, use `kill … 2>/dev/null \|\| true`, and keep `rc`. It also needs a check for the load=0 path. | |
| F1-2 | Minor | Contracts (spec.md:46), done-when 3 | spec.md:50 (Edge cases) | "A file that times out shows `timed out` in its cell" does not match run.mjs. A timed-out file's seconds always exceed 5/6 of its timeout (`nearTimeout`, run.mjs:110), so the real row is `timed out, near timeout[ (run N)]`. A `failed (…)` row can also carry `, near timeout`. The spec should state the real strings, and say that only a result that is exactly `ok` once `, near timeout` is stripped counts as ok. Otherwise a parser that treats any `, near timeout` cell as ok-but-marked would pass a timeout as green. | |
| F1-3 | Minor | done-when 4 | spec.md:23, spec.md:34 | The spec says "The PR's last commit removes the trigger", but the plan (plan.md:88) uses "the last code commit; review records and verification may follow". That reading holds up: final-review records have to be committed after the head they name, so the literal last commit can never be the removal. But spec and plan should say the same thing, and the check should be mechanical: `git diff <removal-commit>..HEAD -- .github/` is empty at the final head. Note also that verification.md is not a review record. Committing it after the final reviews voids their verdicts (quality.md §3, "At an exact head"), so it has to land before the final reviews. | |
| F1-4 | Minor | done-when 2 | spec.md:21, spec.md:65 | "actionlint, which flags script injection" overstates the check. actionlint's injection check covers untrusted contexts such as `github.event.*` and does not flag `${{ inputs.* }}` inside `run:`. The grep for `${{` inside `run:` is the real guard, so the spec should rest done-when 2 on the grep alone and not count actionlint toward it. Also, actionlint lints `run:` scripts with shellcheck only when shellcheck is on PATH, and skips that silently otherwise. | |
| F1-5 | Minor | done-when 2 | spec.md:35-36 (validation) | The input checks should be exact patterns (`^[1-5]$`, `^[0-8]$`). An integer range check lets `05` or `08` through, and `08` breaks bash arithmetic (it reads as octal). Also, `read -ra` reads only the first line of `FILES`, so a `gh workflow run -f files=$'a\nb'` silently drops the rest. Newlines in `FILES` should be rejected. | |
| F1-6 | Suggestion | Design step 4 | spec.md:40 | Anchor on the last line matching `^summary: \d+ files?, concurrency \d+$`, not the first `summary:` line, so stray output from a test can't move the start of the table. Lines after the rows (`timed out: …`, `failed: …`) don't match the row regex and should be skipped by rule. The rc≠0 check keeps the run red if a row is ever missed, which is good. | |

Values and refusals (strategy.md):
- P1 harness-agnostic: not affected (kit CI only).
- P2 nothing project-specific: holds. The workflow lives in the kit's own `.github/` and is not materialized into instances.
- P3 decide and report / P4 owner-only questions: no owner question is raised.
- P5 authority: touches no authority path. `contents: read`, and only users with write access can dispatch.
- P6 simple: holds. One job, inputs only through env, one inline parser.
- R1: no rung, approval or owner line can be raised by it.
- R2: produces no owner-facing message (the job summary is for agents).
- W3: serves it, because flaky files are found off the PR path.

Verdict: CHANGES d499577ae29fcf95bb00c6968b1a0fce62d564ba
