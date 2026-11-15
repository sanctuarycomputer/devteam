# Final review, pass 1

- Reviewer: kit-100-inbox-in-panel worker session (claude-opus-5-5); has not seen kit-205's build
- Reviewed: b3c28ebbf19a42914c14ada029d3821e699763c9 (the whole branch, in `review-worktree kit-205-merge-reuses-green-ci b3c28eb`)

## What I read and ran

- **Read:** spec, plan, the task reviews (task-1, task-1-2, task-2, task-2-2), verification.md, and the diff against `origin/main`: `devteam.mjs` (`rollupState`, `forgeCoverage`, `forgeCheckFails`, the `cmdMerge` gate block and the act's `what`), `quality.md` §2 and the merge line, `supervisor.md` Merging, and `test/kit.test.mjs`'s covered_by tests.
- **The owner's rule:** `gateAdditions` and `newGateProblem`, unchanged, so `covered_by` stays the owner's gate field.
- **The ticket's tests:** `run-tests.sh` passed (exit 0: 15 pass, 0 fail). `mutate-t1.sh` passed (exit 0: the mutated run fails, 2 fail). `mutate-t2.sh` passed (exit 0: both mutations caught).
- **My own mutations,** each in a scratch copy, with `--test-name-pattern=covered_by`. Every one made the run fail (exit 1, 2 fail):
  - the head-moved check disabled;
  - the `.github/` check disabled;
  - `"ci"` accepting SKIPPED and NEUTRAL;
  - `"ci"` dropping `ignored_checks` entries;
  - forge `git` treated as having checks;
  - the act's `what` notes dropped. (That patch may have broken the syntax rather than only dropping the notes; D1 asserts the act's `what` directly in any case.)
- **CI:** run 43773504520 concluded `success` at e188a69. The commits from e188a69 to b3c28eb change only this ticket's folder (`verification.md`, `ci-wait.sh`).
- **D4:** `git diff --name-status origin/main...HEAD` outside the ticket folder shows only `M` (quality.md, supervisor.md, devteam.mjs, kit.test.mjs).

## Done-whens

- **D1.** A real sibling-repo ticket merge with a fake gh. The gate's marker is not written, and no `gate` line is logged. The output names the gate, the sha and the checks, and the `merge-word` act's `what` carries them.
- **D2.** Every case the spec lists runs the gate with its reason. The pending and failed cases are read on the second view, since the first read already refuses them. The PR changing `.github/` fails closed, as do the head moving, a failed re-read, forge `git`, and a diff that can't be computed.
- **D3.** A gate without `covered_by` runs. A bad shape warns and runs. Adding `covered_by` to an existing gate is `gateAdditions`' "it changes", so it needs a gate-change answer, and a new supervisor gate can't carry it. Both are pinned by tests and by mutate-t2.
- **D4.** CI is green at the head of the code, and no file is added.

## Strategy

- **R1:** the owner keeps the trust decision, per gate, as a gate-change. The supervisor can't declare coverage.
- **Fails closed:** every unreadable or ambiguous state runs the gate.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | quality.md §2 (comments and readability) | docs/devteam/scripts/devteam.mjs:5059-5065 | The comment that describes `forgeCheckFails` ("The forge's own checks on a PR at its head: pending is not passed…") now sits above the new `rollupState`, with `forgeCoverage` between them, so it reads as `rollupState`'s comment. Move it down to `forgeCheckFails` | |

Verdict: APPROVE b3c28ebbf19a42914c14ada029d3821e699763c9
