# Task 2 review, pass 2

- Reviewer: task-reviewer-2b (fresh subagent, claude-sonnet-5-5)
- Reviewed: c427f9b7d5c8ab7b646344d7d6924fdca6d4d572

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-2-1 | Minor | test coverage (outside the verdict) | docs/devteam/scripts/devteam.mjs:11754 | The no-goal fallback hint (`ask … --links '[{"title":"The plan","ref":"plan/<feature>","path":…}]'`) is untested. `cmdAsk` accepts `--links` and the item has exactly one way (`path`, devteam.mjs:6081-6087), so it is accepted; `ref` is an extra key that ask ignores for non-strategy links. It is only reached when a planner serves no goal. | |

Pass-1 findings:
- T2-1: fixed. The planner hint is now `ask on its goal (ask --goal <first goal> …); otherwise answer its blocked message` (devteam.mjs:11754-11755). It never names `--blocks plan-…`. `--goal` is accepted by cmdAsk (devteam.mjs:5870-5990, `flagStr('goal')`), and a plan branch's question is held through `waiting_on_owner` by goal (devteam.mjs:3396). The test asserts the `--goal <g3>` text and `doesNotMatch /--blocks plan-/` (test/dashboard-data.test.mjs:~205-207). The ticket hint is unchanged.
- T2-2: fixed. `continue` when `p.parked` or `modeOf(goals)` is park/let-go (devteam.mjs:11753). An empty goal list gives `modeOf` 'run', so it is not skipped. The test parks g3 and expects no finding (test:~209-210).
- T2-3: fixed. A let-go goal with an open `--blocks app-05-e` question gives `heldBy` null (test:~197-200), which covers the `q.goal_hold !== 'let-go'` clause.

Focused run `gate test -- node test/run.mjs --concurrency 2 test/dashboard-data.test.mjs`: 2 pass, 0 fail, exit 0.

Verdict: APPROVE c427f9b7d5c8ab7b646344d7d6924fdca6d4d572
