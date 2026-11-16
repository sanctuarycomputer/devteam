# kit-243 re-plan reviews hold at head: plan

## TL;DR

- One code change in `cmdValidate` (`docs/devteam/scripts/devteam.mjs`): compute the plan branch's feature once (`planFeature`), and run the strict head check for a landed feature when it is `planFeature`.
- One new test in `test/kit.test.mjs` (threadsFixture-based, standalone): first plan stale/fresh, land it, re-plan stale/fresh, graph and design both.
- TDD: the test fails on the re-plan stale assertion before the code change.
- Local runs: only `test/kit.test.mjs` with `--test-name-pattern` for the new test, `--test-concurrency=2`, with `timeout`; CI (`test.yml`) is the gate.
- No contract, no one-way door.

## Rulings

- m-20261116-152938511-supervisor: lighter review depth; no `reviews/task-<n>.md`; full final review.

## Tasks

### T1: the test (red)

- Model: strong
- `test/kit.test.mjs`: new top-level test "validate --strict on a re-plan branch checks its latest design and graph verdicts hold at the head, as a first plan's". Fixture: `threadsFixture('replan')`; make the goal ready if strict validate needs it. On `plan/<fid>` worktree: planner adds feature (design with TL;DR, citing itself), one ticket; commit; reviews graph-1/design-1 at that sha; commit; strict passes; change a ticket, commit → fails `/graph review .* does not hold at HEAD/` and `/design review .* does not hold at HEAD/`; reset. Merge into main, push. New branch `plan/<fid>` (re-plan) off main: change a ticket, commit → strict fails with the same two messages (red today); add graph-2/design-2 at head → passes.

### T2: the fix (green)

- Model: strong
- `cmdValidate`: hoist the plan branch feature (`pf` in the id-block check) to `planFeature`, reuse it there; `head = flags.strict && commonDir && (!landed || fid === planFeature) ? resolveCommit('HEAD') : null`. Update the comment.
- Run the new test green.

## Amendment during build (inside touches)

- Found in T2: the merge gate, `check-pr` (and `merge`, through `checkPr`), runs `validate --strict` in a **detached** worktree of the plan head, where `onPlanBranch()` is false, so a branch-name-only fix never reaches the gate. `check-pr` now passes `validate --strict --plan <feature>`; `validate` takes `--plan <feature>` as the plan feature, else the branch name. The id-block warning keeps using the branch name only (unchanged).
- The T1 test also runs `check-pr` on the first plan (stale: fails) and the re-plan (stale: fails; reviewed at head: passes). Without `--plan` in check-pr, the re-plan stale `check-pr` assertion fails (checked by hand).
