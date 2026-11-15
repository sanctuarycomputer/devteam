# Task review, task 1, pass 1

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus-5-5)
- Reviewed: bc26e57c6da1853e89c1a93a1b017613136b65a2 (0939aca..bc26e57)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Important | spec, Edge cases ("Several checks with one name (a re-run): every entry with the name must be SUCCESS; one old failed attempt beside a new green one … isn't covered"); spec D2 ("a named check twice, one failed"); quality.md §3 Severity ("missing test with a plausible failure path") | test/kit.test.mjs, `merge covered_by: when coverage fails…` subtest 1, row `[['test'], green, [covRun('test'), covFailed('test')], /test is failure/]` | The duplicate-name row only tests the failed entry coming last. The spec's case is the re-run order: an old failed attempt, then a new green one. I mutated `forgeCoverage` to judge only the last entry of each name (`mine.slice(-1).find(…)`) and every test still passed (run-tests.sh exit 0). So a plausible later change would skip a gate that the spec says must run, and no test would catch it. Examples of such a change: "use the latest attempt", or a name-keyed Map that keeps the last entry. The opposite mutation (`mine.slice(0, 1)`, first entry only) does turn red, so the test pins one order only. Fix: add a row with `[covFailed('test'), covRun('test')]`, the failed entry first, expecting `/test is failure/`. A matching `"ci"` row would pin the same thing for `entries.find`. |  |
| T1-2 | Minor | plan Task 1 Step 3 ("the diff itself … never `changedFiles`, which reads a failed diff as no files") | docs/devteam/scripts/devteam.mjs, gate block, `const diff = base ? R.git(['diff', '-z', …]) : null` | No test checks that the `.github/` check fails closed when the diff itself fails. I swapped the diff for `(R.changedFiles(base, sha) ?? []).join('\0')` and the tests stayed green (exit 0). The code is correct, and its comment says why it reads the diff directly. A failing `git diff` with a valid merge base is hard to set up in a fixture, so this does not block. |  |
| T1-3 | Suggestion | none (taste) | docs/devteam/scripts/devteam.mjs, `forgeCoverage`, `"ci"` branch | Under `"ci"`, a rollup made only of `ignored_checks` entries that are all SUCCESS counts as covered, and the act lists the ignored names as the coverage. This matches the plan's interface: every entry, ignored ones included, must be SUCCESS. But the spec's phrase "an ignored check is never coverage" could be read more strictly, as "an ignored check alone can't cover". This is noted only, not reopened. |  |

## What I checked

**Spec and plan against the code.** Each item below matches the spec and the plan's Task 1 interface:
- `rollupState` has the same reading as the old inline expression. Empty, null or unknown states become `PENDING`. Dropping `''` from `forgeCheckFails`'s pending list changes nothing, because `rollupState` now maps `''` to `PENDING`.
- `forgeCoverage`:
  - A value of the wrong shape returns `bad`.
  - `"ci"` refuses an empty rollup and requires every entry to be SUCCESS, ignored entries included. SKIPPED and NEUTRAL do not count.
  - A list requires each named check to be present, and every entry with that name to be SUCCESS.
  - The reason names the first check that stops coverage, plus the ignored_checks suffix when that check is ignored.
- The gate block:
  - It works only on gates that apply and declare `covered_by`.
  - The fail-closed checks run in this order: forge `git`, then no PR number, then a diff that fails or has no base, then `.github/` files between the merge base and `sha` (read with `-z --no-renames`).
  - It then re-reads the PR once, by number. That read fails closed if gh fails or the JSON doesn't parse, and when `headRefOid !== sha`.
  - A covered gate is printed with the 12-character sha and check names, is left out of the run loop, and writes no `gate` line. Its note goes into the merge act's `what` with the full sha.
  - A bad shape warns and the gate runs. A gate that isn't covered prints its reason and runs as before, so ratchet still applies.
- These are unchanged: chores, `--no-gates`, `paths` not applying, and the first-read refusal.
- A repo link's re-read goes through `R.gh`, which adds `-R`.
- The plan's tests 1–12 are all present. Tests 3–12 are subtests sharing one fixture, as the ruling allows. Test 10 uses `web/**` where the plan says `docs/**`, which makes no difference.

**Runs.** Every run used the ticket's `run-tests.sh` and was judged by its exit code.
- At the worktree head: exit 0. All 3 covered_by tests and all 10 subtests passed; the 5 tests skipped were ones the name pattern didn't match.
- `test/merge-admin.test.mjs`, the other test file that reads the rollup: exit 0, 4 of 4 passed.
- While I was reviewing, the worktree moved past bc26e57 to 1349bf8 (Task 2 commits). I checked what changed: `git diff --quiet bc26e57 HEAD -- docs/devteam/scripts/devteam.mjs` gives 0, and `test/kit.test.mjs` only gained lines (no deletions; the two Task 2 tests were added). So these runs are evidence for the code and tests at bc26e57.

**Mutations.** Each ran in a fresh copy of `docs/` and `test/` in a private mktemp directory, using that copy's `run-tests.sh`. Exit 1 means at least one test went red, so the mutation was caught:

| Mutation | Exit | Result |
|---|---|---|
| `"ci"` accepts SKIPPED | 1 | caught |
| Head-moved check dropped | 1 | caught |
| `changedFiles` used instead of the diff | 0 | survived (T1-2) |
| `.github/` check skipped | 1 | caught |
| List accepts NEUTRAL | 1 | caught |
| `"ci"` leaves out ignored_checks entries | 1 | caught |
| List judges only the last entry of a name | 0 | survived (T1-1) |
| List judges only the first entry of a name | 1 | caught |
| Empty or null conclusion read as SUCCESS | 1 | caught |
| Failed re-read falls back to the first read's rollup | 1 | caught |
| Empty-rollup check under `"ci"` removed | 1 | caught |
| Covered note left out of the act's `what` | 1 | caught |
| Forge `git` treated as a green rollup | 1 | caught |

I also tried adding `PENDING` to `forgeCheckFails`'s failing list. That code can never be reached, because PENDING is already sorted into the pending list first, so the mutation changes nothing and I discarded it.

I found no Critical issue in the code: in every case I traced, a gate is skipped only on a green re-read whose `headRefOid` equals `sha`. T1-1 blocks because the spec names that re-run order explicitly, and the test that should pin it lets a wrong implementation pass.

Verdict: CHANGES bc26e57c6da1853e89c1a93a1b017613136b65a2
