# Spec review, pass 2

- Reviewer: spec-plan-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: ac48e8ad2c667b5622cfdc2a841b4592b216c6e2 (spec.md)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S2-1 | Suggestion |  | spec.md acceptance 8 | `grep -c -- '--test-timeout' .github/workflows/test.yml` counts comment lines too, so the check prints 0 only if no comment names the flag. The plan asks for a comment saying the watchdog replaces `--test-timeout` (see plan-2 P2-2). Say here that the workflow names the flag nowhere, comments included, or narrow the grep to non-comment lines. |  |

Pass 1 follow-up. S1-1 is fixed: acceptance 5 now runs the coverage step's own script, extracted from `test.yml`, on real lists laid out as download-artifact v4 writes them (`lists/list-<node>-<key>/list.txt`). It runs once on the real lists and once each with a duplicate, a missing file and a missing major. S1-2 is fixed: the ps step runs on `failure() || cancelled()`, so it also runs after a job-level timeout cancels the job, and the upload comes before both run steps, so the list is already uploaded by then. S1-3 is fixed: `overwrite: true` and `retention-days: 7`. A re-run of failed jobs keeps the same run id, so download-artifact v4 still finds the green jobs' lists. S1-4 is fixed, with the reason given in one line.

Read cold. The 16 rows match done-when 1. I ran `run.mjs --list` for each argument set at this head. `alone` is `bounds.test.mjs` alone. Chain plus alone plus the two shards gives 67 files on 18/20 (`rest,chrome`) and on 22/24 (`rest` plus `chrome`), each file once. `gitleaks.test.mjs` lands in rest 1/2 on 18/20 and in rest 2/2 on 22/24, so gitleaks has to be installed in both rest jobs, as the spec says. `dashboard.test.mjs` lands in rest 1/2 on 18/20 and in chrome 1/2 on 22/24, and done-when 6's exception covers both. `test/run.test.mjs:625` is kit-209's `timed out: … (last test finished: first passes)` assertion, and `run.test.mjs` is in a rest shard on every major. The concurrency expressions passed actionlint 1.7.12 on a scratch workflow. A push to main gets its run id as its group, so it is never cancelled and never waits. A PR run is keyed on its number. `needs.kit.result` over a matrix is `success` only when every leg succeeded. `if: always()` on `tests` keeps it red, not skipped, in a failed or cancelled run. The repo is public, so `nproc` is 4 on `ubuntu-latest`.

Values and refusals (`project/strategy.md`): unchanged from pass 1. This is the kit's own CI config. The only owner decision, the required-check change, goes as a gate-change through the supervisor. No authority code is touched, and no path lets a red job become a skipped required check.

Verdict: APPROVE ac48e8ad2c667b5622cfdc2a841b4592b216c6e2
