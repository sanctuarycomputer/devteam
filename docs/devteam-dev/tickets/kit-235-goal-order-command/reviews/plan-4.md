# Plan review, pass 4

- Reviewer: cold-confirm reviewer 4 (fresh subagent, claude-opus-5-5)
- Reviewed: 09db04fe16f8b6205eb1b7c840619e2c0c682677 (plan.md, diff since 01f8e46)

Read the plan diff since 01f8e46 against plan-3.md and its dispositions and the revised spec, and checked it against the same code as spec-4 (`questionView`, `goalChangeProblem`, `goal set --approved`, the Inbox card, `askPlainChecks`). F3-1 is fixed. Task 2's test asserts the view's `change` is null, its `order` is set, and the context holds `The order proposed:` and each numbered `<title> (<id>)` line. That test fails against the plausible failures: a view that still passes `change` through, and an order missing from the context. The implement step adds both `change: null` and the context text. F3-2 is fixed: the x-tip is listed. The existing refusal test (`goal set <g> --approved <order qid>`) still covers the one-goal path against the null `change`. The plan inherits spec-4 F4-1 (where the context text is joined relative to the plain-language checks), which is Minor.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F4-1 | Minor | spec-4 F4-1 | Task 2 implement ("`ask` appends the order in words to the context") | Say that the order text is joined after `askPlainChecks`, or that the checks see only the supervisor's own `--context`. Otherwise every order question warns about the kit ids the kit wrote itself. A test asserting that ask's stderr has no `names a kit id` warning would pin it. | fixed in build: the order text is added after askPlainChecks, so only the supervisor's own --context is checked; Task 2's test asserts no kit-id warning |

Verdict: APPROVE 09db04fe16f8b6205eb1b7c840619e2c0c682677
