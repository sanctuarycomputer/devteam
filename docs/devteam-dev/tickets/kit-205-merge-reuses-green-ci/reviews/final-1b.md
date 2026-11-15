# Final review, pass 1 (track b)

- Reviewer: final-reviewer-1b (fresh subagent, claude-opus-5-5; has not seen the build)
- Reviewed: b3c28ebbf19a42914c14ada029d3821e699763c9 (the whole branch against merge base 5bdc45c with origin/main), in `review-worktree`

## What was checked

- Read spec.md, plan.md, verification.md, every spec, plan and task review, and the full diff (devteam.mjs, kit.test.mjs, quality.md, supervisor.md).
- `sh run-tests.sh` (kit.test.mjs filtered to `covered_by`): exit 0, 15 pass, 0 fail.
- `sh mutate-t1.sh`: exit 0 (the mutated run failed). `sh mutate-t2.sh`: exit 0 (both mutations caught).
- The reviewer's own mutations, each in a scratch copy, the `covered_by` tests run against it: the head-moved check dropped (caught, exit 1); the `.github/` check dropped (caught, exit 1); `"ci"` accepting SKIPPED/NEUTRAL (caught, exit 1); ignored checks left out of `"ci"` (caught, exit 1); a failed re-read treated as a green rollup (caught, exit 1).
- CI: `gh run view 43773504520` is `success`, headSha e188a69 (what verification.md cites); test.yml at b3c28eb itself (run 43774011185) is `success` too. e188a69..b3c28eb adds only verification.md and ci-wait.sh in this folder. The PR's head is b3c28eb.
- `git diff --name-status` against the merge base, outside this folder: only `M` on the four touched files (D4).
- The logic, against the spec:
  - Settings come from `R.settings` (main's checkout), never from the PR's head, so a PR can't declare its own coverage. A repo link's `gates` field is classed `gate-change` (`REPO_GATE_KEYS`), so the link form is the owner's as well. A chore that adds `covered_by` to a home gate is refused without the owner's answer (tested and mutation-checked).
  - The coverage is judged on a fresh `pr view <number>` whose `headRefOid` has to equal `sha`, and `gh pr merge --match-head-commit sha` holds the landed commit to that same sha. A failed read or an unparsable answer, forge `git`, no PR number, a failed diff and a `.github/` change all cover nothing.
  - `rollupState` keeps today's reading (an empty state becomes `PENDING` instead of `''`, and `''` left the pending list, so the result is the same). Under `"ci"`, every entry has to be SUCCESS, the ignored ones included. Under a list, every entry of a name has to be SUCCESS. SKIPPED, NEUTRAL, null or unknown never count as coverage.
  - A covered gate writes no `gate` line and is named in the act's `what`. Gates that aren't covered run as before, ratchet included.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec §The change ("a CheckRun's `name` or a StatusContext's `context`"); ticket notes (not defended: a forge that reports green for a run it didn't do) | docs/devteam/scripts/devteam.mjs:5084 | A list `covered_by` is met by a StatusContext of that name. On GitHub, anyone with push access can post a commit status with a PAT (`POST /repos/…/statuses/<sha>`), but a CheckRun takes a GitHub App. So a worker's token could post `test: success` at its own head. Where the real `test` job didn't report (a path filter, a workflow that didn't trigger), that alone covers the gate and the merge lands with the owner's suite never run. The spec chose to accept StatusContexts, so this doesn't block at final review (§3: final reviews don't reopen the spec). Suggested follow-up: an option to count only CheckRuns, or a sentence in quality.md that a status context is coverage anyone with push access can post. | |
| F2 | Minor | quality.md §3 Scoped | docs/devteam/scripts/devteam.mjs:5379 | The `no PR to read` branch (a `--dry-run` on a branch with no PR) has no test. It fails closed even without the guard (`gh pr view undefined` fails, which reads as "could not read"), so no failure path is plausible. Noted for completeness. T1-2 (a failed diff) is the known untested path, and its wont-fix was agreed. | |

Process note for the supervisor, not a code finding: the ticket's `depends_on` is kit-202-lost-enter-retries, whose PR #282 is still open and not on origin/main. verification.md's ruling m-20261115-231146737 says no merge-request until it merges.

Verdict: APPROVE b3c28ebbf19a42914c14ada029d3821e699763c9
