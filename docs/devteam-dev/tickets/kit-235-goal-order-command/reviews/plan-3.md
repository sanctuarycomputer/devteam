# Plan review, pass 3

- Reviewer: cold-confirm reviewer 3 (fresh subagent, claude-opus-5-5)
- Reviewed: 01f8e46e676a91b528326df393105c1644e45277 (plan.md, diff since 8f27713)

Read the plan diff since 8f27713 against plan-2.md and its dispositions, the revised spec and the code (fold ~1316-1425, `questionView`, `goalChangeProblem`, `SCHEMA_CHECKED`, dashboard/index.html ~1445). F2-1 is fixed: the older-reader test deletes `change.properties.order` (main's shape), answers the order questions first, and asserts no `fail:` and one answered question. F2-2 (goal added later, created-at filter), F2-3 (drafts A and B in the rank and fold tests, check before the draft branch) and F2-4 (`uniqueItems` in `SCHEMA_CHECKED`) are fixed as disposed. `goal set <g> --approved <order qid>` refused is still tested. The plan inherits spec-3 F3-1: no task touches or tests the Inbox card, which now renders an order question's `change` as a one-goal change with a null goal.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F3-1 | Important | spec-3 F3-1; quality.md §3 (a test that passes against a plausible failure) | Task 2 implement (`change: { order }`, `questionView` `order`); Task 3 | With the order in `change`, the dashboard's Inbox card (index.html ~1445) shows "Approving sets on" with an empty `#goal/null` link and "Order: [raw ids]". No task changes that, or `questionView`'s `change` for an order question, and no test reads the card or the view the card uses, so every planned test passes while the owner's approval card is broken. Add the step that spec-3 F3-1 settles on, either `questionView` giving `change: null` with an order or the card rendering the order (index.html then needs a touches ruling), and add a test, for example on `questions --json` or the dashboard's data, that an order question's card shows no one-goal change. | |
| F3-2 | Minor | spec-3 F3-3 | Task 2 implement ("the three descriptions") | Name `question.change`'s `x-tip` among the prose to update. | |

Verdict: CHANGES 01f8e46e676a91b528326df393105c1644e45277
