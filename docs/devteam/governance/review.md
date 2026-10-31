# Review

What counts as a review, how it is recorded, and how its quality is measured. Adversarial review is a pillar of devteam: it is the main defect filter between an agent's first pass and `main`.

## 1. What a review is

- **Non-author.** The reviewer did not write the work. A fresh subagent started by the author counts as non-author for **spec, plan and task** reviews on any ticket. **Final** reviews come from a fresh reviewer that has not seen the build: a fresh subagent is enough on a `normal` ticket; on a `risk: high` ticket (see `planning.md` §5) there are two, from two sessions other than the worker's, ideally on different models.
- **Adversarial.** The reviewer's job is to find the defect. Its default verdict is **not approved**; it approves only when it has looked and failed to find a Critical or Important issue.
- **Against the rules, not taste.** Findings cite the governing text: a Law id from `code-style.md`, a line of the spec, a contract clause, a gate in `quality-gates.md`. A finding that cites nothing is a suggestion, and suggestions never block.
- **Scoped.** The reviewer reads the diff and everything it cites, not the whole tree. Where a test cannot prove a property, the reviewer mutates the code in a scratch copy to check that a test fails.
- **At an exact head.** A verdict names the commit it reviewed. Committing the record moves the head, so the verdict still holds at a later head **only if every commit since then just adds new review-record files**. Editing or deleting any review record, or changing any other file, invalidates it; so does merging `main` in. A dissenting record can't be quietly edited away: answer it with a new pass.

## 2. Stages that are reviewed

| Stage | What is reviewed | Passing verdict needed before |
|---|---|---|
| design | the system design doc | the feature plan is written |
| graph | the feature plan + every ticket file | any ticket is made |
| spec | the ticket spec | `approve spec` |
| plan | the ticket plan | `approve plan` |
| contract | a contract change, against the contract checklist | the supervisor's stage word |
| task | each build task's diff | the next task starts |
| final | the whole ticket branch at its final head | the merge word |

## 3. Passes

1. **Pass 1, adversarial.** Full review; produces findings.
2. The author fixes.
3. **Pass 2, cold confirm.** A reviewer who is neither the author nor the fixer re-checks the fixes, diff-only, and flips the verdict. A "changes needed" verdict plus an author note saying "fixed" is **not** an approval. A new Critical in pass 2 forces pass 3.
4. **Cap.** If pass 3 still finds a Critical, stop and message the supervisor (`blocked`); the ticket probably needs re-planning.

**Two independent reviews** (from two different sessions) are required for `risk: high` tickets and for every one-way door (`constitution.md` §3).

## 4. Severity

| Severity | Meaning | Blocks |
|---|---|---|
| Critical | wrong behaviour, data loss, security hole, broken contract, a Law violated without an escape-hatch marker | yes |
| Important | a real defect or missing test with a plausible failure path; a Doctrine rule ignored with no stated reason | yes |
| Minor | correct but worse than it should be: naming, structure, a missing comment on non-obvious code | no |
| Suggestion | taste, or anything that cites no rule | no |

## 5. The review record

Every review is a file, written with [`templates/review-record.md`](../templates/review-record.md), at:

```
docs/devteam/project/tickets/<ticket-id>/reviews/<stage>-<pass>[<track>].md   spec, plan, contract, task, final
docs/devteam/project/reviews/<feature>/<stage>-<pass>[<track>].md           design, graph
```

`<pass>` is 1, 2, 3 (`review.md` §3). `<track>` is empty for the first independent review and `b`, `c` for further independent ones (for example `final-1.md` and `final-1b.md` on a `risk: high` ticket). Ticket review records are committed on the ticket's branch; feature review records on the planning branch.

The record must name its reviewer on a `- Reviewer:` line; an unnamed record does not count. Its last line is the verdict, with the **full 40-character SHA**, exactly one of:

```
Verdict: APPROVE <full-head-sha>
Verdict: CHANGES <full-head-sha>
```

Each finding is one row with an id, severity, the rule it cites, the location, and a **disposition** the author fills in: `fixed`, `wont-fix` (with reason, needs reviewer agreement), `disputed` (goes to the supervisor), or `wrong` (the reviewer agrees it was a false positive).

`check-ticket` fails a PR when: no final review was made at its exact head; the **latest** final review in any track at that head says `CHANGES`; fewer named reviewers approved it than the ticket's risk requires; or any Critical or Important finding in any of the ticket's review records lacks a `fixed`, `wont-fix` or `wrong` disposition. `validate` fails an approved feature plan whose latest design or graph review is missing or not `APPROVE`.

## 6. Measuring review quality

`devteam.mjs status --json` aggregates every review record into:

- **first-pass rejection rate** per stage. A healthy fleet rejects a meaningful share of first passes (observed: 20 to 30%). If it drifts toward zero, the reviewer prompt has gone soft; sharpen it.
- **false-positive rate**: share of findings dispositioned `wrong`. If high, the reviewer is citing taste; tighten §1.
- **escape rate**: defects found after merge that a review should have caught, logged by the supervisor as observations with kind `escaped-defect` and the ticket as subject (`devteam.mjs observe --subject <ticket-id> --kind escaped-defect --severity <n> --valence -2 --detail "…"`).

The supervisor reviews these numbers weekly and proposes prompt or rule changes through `constitution.md` §4.
