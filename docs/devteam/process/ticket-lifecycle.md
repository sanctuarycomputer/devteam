# Ticket lifecycle

How one ticket goes from a graph file to a merged PR. This is the canonical stage list; [`worker.md`](worker.md) covers how a worker session runs it, and [`supervisor.md`](supervisor.md) covers the approvals.

```
spec → plan → [contract stage] → build, task by task → verification → final review → merge word (supervisor merges)
```

Every stage ends with an adversarial review by a non-author ([`../governance/review.md`](../governance/review.md)). Every artefact lives in `docs/devteam/project/tickets/<ticket-id>/` on the ticket's branch. **Commit artefacts as you produce them:** the supervisor and CI read them from the branch (`devteam.mjs status` reads the branch tip; `check-ticket` reads the exact head), never from your working tree.

## 1. Spec

- **Write** `spec.md` from [`templates/spec.md`](../templates/spec.md): what the ticket delivers, restating the ticket file's done-whens as acceptance checks, the contracts it provides and consumes, edge cases and error arms, and what is out of scope.
- **Review** `spec-1.md`. Then the supervisor's `approve spec` sets `Status: approved` (the supervisor edits the line, or tells the worker to, citing the review).
- **Spec-ahead:** a ticket may write and get approval for its spec while its dependencies are unmerged.

## 2. Plan

- **Write** `plan.md` from [`templates/plan.md`](../templates/plan.md): an ordered list of tasks. Each task has a file map (all inside the ticket's `touches`), the test it adds first, and a machine-checkable done-when. Tasks are small enough to review in one sitting.
- If the plan needs to touch a file outside `touches`, **stop**: that is a design change (§6), not a plan detail.
- **Review** `plan-1.md`, then the supervisor's `approve plan`.

## 3. Contract stage (only for tickets that provide a contract)

- The contract change is committed first, alone, with its version bumped and its fake or stub.
- Version numbers serialize: re-read `main`'s current version immediately before committing and take the next free one. If two contract stages race, the first to be ready takes the lower number.
- The supervisor reviews the contract diff itself against the contract checklist in the binding and gives the **stage word** before any build task begins.

## 4. Build, task by task

The build stage starts only when every `depends_on` ticket is merged. For each task in the plan:

1. Write the test. Run it. **It must fail** for the right reason.
2. Write the smallest code that makes it pass.
3. Refactor, run the full component gates locally (autofix first).
4. Commit. Update the run state (`worker.md` §4).
5. A non-author reviews the task diff (`task-<n>.md`). Fix findings, cold-confirm, continue.

The worker decides for itself whether to dispatch subagents for a task's implementation or review. A subagent the worker dispatches counts as a non-author reviewer for **spec, plan and task** reviews on any ticket. Final reviews follow `review.md` §1: on a `risk: high` ticket, two final reviews from two different sessions.

## 5. Verification

- `verification.md` from [`templates/verification.md`](../templates/verification.md): every done-when, the exact command run, and its result, at a named commit.
- Anything that can't run in CI (real hardware, real third-party accounts, latency on a quiet machine) is either run in a slot the supervisor grants (see `supervisor.md` §7) or marked **deferred to beta** with the binding's reason, and then becomes a release-time check.

## 6. Design changes mid-build

If the build reveals that the spec, plan, a contract or the ticket's `touches` is wrong:

1. **Stop.** Do not invent a fix.
2. Ask the supervisor with a question of kind `design-change` ([`questions.md`](questions.md)), stating what is wrong, the options, and a recommendation.
3. Work on anything in the plan that the question does not touch while waiting.
4. Record the ruling in the spec's or plan's **Rulings** section, then continue. If the ruling changes the graph, the supervisor re-plans (`planning.md` §8).

## 7. Final review and the merge word

1. Merge `origin/main` into the branch; resolve conflicts; re-run gates. Check that every answered question about your ticket is copied into the spec's or plan's Rulings section and marked with `devteam.mjs recorded`.
2. Push. Open the PR (or mark it ready) with title `<ticket-id>: <title>` and the body from [`templates/pr-body.md`](../templates/pr-body.md).
3. A fresh non-author runs the final review (`final-1.md`) over the whole branch. `risk: high` tickets get a second final review from a different session (`final-1b.md`).
4. Fix, cold-confirm, until the latest final review in every lineage says `APPROVE` at a commit that holds at the current head (at its own commit, or at a later head whose only changes are newly added review records; `review.md` §1). Fill in dispositions on earlier records during the fix wave, before the confirming pass; once an approving verdict is committed, add only new record files after it (editing or deleting any record voids the approval).
5. Commit and push everything, then run `devteam.mjs check-ticket <id> --title "<pr title>"`; it must pass at your pushed head. CI runs the same check as the required `merge-word` status.
6. Ask the supervisor for the merge word, naming the exact head SHA (`devteam.mjs ask --kind merge-request --question "merge word for <id>"`; the script records your head).
7. **Do not merge.** The supervisor verifies and merges itself (`supervisor.md` §6). Pushing anything after asking invalidates the request; ask again with the new head.

## 8. Using Superpowers

If Superpowers is installed, it maps onto these stages; devteam adds the rules on top.

| devteam stage | Superpowers skill | devteam adds |
|---|---|---|
| spec | `brainstorming` | write to `spec.md`; review + `approve spec` |
| plan | `writing-plans` | tasks confined to `touches`; review + `approve plan` |
| build | `subagent-driven-development` or `executing-plans`, with `test-driven-development` | a review record per task; run-state updates |
| debugging | `systematic-debugging` | design questions go to the inbox, not into code |
| verification | `verification-before-completion` | `verification.md` with commands and results |
| finish | `finishing-a-development-branch` | final review records, `check-ticket`, a merge request; the supervisor merges, never the worker |

Where a Superpowers skill and this doc disagree, this doc wins (it is local governance).
