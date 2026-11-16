# Task review, task 1, pass 2

- Reviewer: task-reviewer-1b (fresh subagent, claude-opus-5-5, cold confirm)
- Reviewed: 4a97c6178017fc9dcc6031d1af8b65455fa120cb (the T1-1 fix, 77205db..4a97c61)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| — | | | | No new findings | |

**T1-1 is fixed.** The fix changes only test code:
- It adds two rows to `test/kit.test.mjs`, in subtest 1 of `merge covered_by: when coverage fails…`. The rows are `[['test'], green, [covFailed('test'), covRun('test')], /test is failure/]` and `['ci', green, [covFailed('test'), covRun('test')], /test is failure/]`. Each puts the old failed attempt first and the new green one after, so the re-run order is pinned for a list and for `"ci"`.
- It adds `mutate-t1.sh`.

`git diff --quiet bc26e57 4a97c61 -- docs/devteam/scripts/devteam.mjs` exits 0, so the production code is the code pass 1 reviewed. The diff 77205db..4a97c61 touches nothing else outside `reviews/`.

I read `mutate-t1.sh` before running it, and it is sound:
- It works on a copy of `docs/` and `test/` in a mktemp directory, with its own HOME and hub port 4793, and unsets every `DEVTEAM_*` variable.
- It changes the list branch to `mine.slice(-1).find(…)` and checks that the patch applied (exit 2 if not).
- It runs only the `when coverage fails` test, deletes the scratch paths with guards, and exits 0 only when the mutated run fails.

Runs, all judged by exit code:
- `sh docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/run-tests.sh`: exit 0. 15 tests passed, 0 failed, and 5 were skipped by the name pattern.
- `sh docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/mutate-t1.sh`: exit 0. The mutated run exited 1, and subtest 1 ("a pending, failed, missing…") went red. Pass 1 recorded this same mutation as surviving at bc26e57, and `devteam.mjs` is unchanged since then, so the new list row is what catches it now.
- My own `"ci"` mutation, run in a private mktemp copy: I made `"ci"` keep only the last entry of each name (`[...new Map(entries.map((e) => [e.name, e])).values()].find(…)`). The run exited 1 and the same subtest went red. None of the older `"ci"` rows has a duplicate name, so the new `"ci"` row is the one that catches it.

The worktree is unchanged (`git status --short` is empty).

**T1-2 (Minor), wont-fix: agree.** The code reads the diff itself, and its comment says why, so it fails closed. Making a `git diff` fail while the merge base is valid would need a git shim around merge's own git calls. That costs more than this Minor finding is worth, and pass 1 already marked it as not blocking.

**T1-3 (Suggestion), wont-fix: agree.** The behavior matches the plan's interface: every entry, ignored ones included, must be SUCCESS. Under that interface, a rollup that is all ignored and all green is green. The stricter reading is a question of taste, not a defect.

Verdict: APPROVE 4a97c6178017fc9dcc6031d1af8b65455fa120cb
