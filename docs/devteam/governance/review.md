# Review

What counts as a review, how it is recorded, and how its quality is measured. Adversarial review is a pillar of devteam: it is the main defect filter between an agent's first pass and `main`.

## 1. What a review is

- **Non-author.** The reviewer did not write the work. A fresh subagent dispatched by the author is acceptable for build tasks; anything marked `risk: high` in the graph (see `planning.md` §5) needs a reviewer from a **different session**, and ideally a different model.
- **Adversarial.** The reviewer's job is to find the defect. Its default verdict is **not approved**; it approves only when it has looked and failed to find a Critical or Important issue.
- **Against the rules, not taste.** Findings cite the governing text: a Law id from `code-style.md`, a line of the spec, a contract clause, a gate in `quality-gates.md`. A finding that cites nothing is a suggestion, and suggestions never block.
- **Scoped.** The reviewer reads the diff and everything it cites, not the whole tree. Where a test cannot prove a property, the reviewer mutates the code in a scratch copy to check that a test fails.
- **At an exact head.** A verdict applies to one commit SHA. Any later push invalidates it.

## 2. Stages that are reviewed

| Stage | What is reviewed | Passing verdict needed before |
|---|---|---|
| design | the system design doc | the column plan is written |
| graph | the column plan + every node file | any node is spawned |
| spec | the node spec | `approve spec` |
| plan | the node plan | `approve plan` |
| contract | a contract change, against the contract checklist | the supervisor's stage word |
| task | each build task's diff | the next task starts |
| final | the whole node branch at its final head | the merge word |

## 3. Passes

1. **Pass 1, adversarial.** Full review; produces findings.
2. The author fixes.
3. **Pass 2, cold confirm.** A reviewer who is neither the author nor the fixer re-checks the fixes, diff-only, and flips the verdict. A "changes needed" verdict plus an author note saying "fixed" is **not** an approval. A new Critical in pass 2 forces pass 3.
4. **Cap.** If pass 3 still finds a Critical, stop and raise a question to the supervisor; the node probably needs re-planning.

**Two independent reviews** (from two different sessions) are required for `risk: high` nodes and for every one-way door (`constitution.md` §3).

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
docs/devteam/project/nodes/<node-id>/reviews/<stage>-<pass>.md
```

Its last line is the verdict, exactly one of:

```
Verdict: APPROVE <full-head-sha>
Verdict: CHANGES <full-head-sha>
```

Each finding is one row with an id, severity, the rule it cites, the location, and a **disposition** the author fills in: `fixed`, `wont-fix` (with reason, needs reviewer agreement), `disputed` (goes to the supervisor), or `wrong` (the reviewer agrees it was a false positive). `check-node` fails a PR whose final review is missing, is not `APPROVE` at the PR head, or has an undispositioned Critical or Important finding.

## 6. Measuring review quality

`devteam.mjs status --json` aggregates every review record into:

- **first-pass rejection rate** per stage. A healthy fleet rejects a meaningful share of first passes (observed: 20 to 30%). If it drifts toward zero, the reviewer prompt has gone soft; sharpen it.
- **false-positive rate**: share of findings dispositioned `wrong`. If high, the reviewer is citing taste; tighten §1.
- **escape rate**: defects found after merge that a review should have caught, logged by the supervisor as events of type `defect.escaped` with the node id.

The supervisor reviews these numbers weekly and proposes prompt or rule changes through `constitution.md` §4.
