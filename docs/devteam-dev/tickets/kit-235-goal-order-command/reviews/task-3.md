# Task review, task 3, pass 1

- Reviewer: task reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: b9b7712bdd48fd42d2277f625b039af62281a7b6 (Task 3, `git diff 12d374d d77f4ea`: dashboard ACTIONS 'goal-order', the supervisor.md row, and their tests in test/goal-order.test.mjs)

I held the diff to spec §5 and §6 and to done-whens 3 and 5. `ACTIONS['goal-order']` accepts only an array of 1 to 50 strings, each matching the dashboard's log-id `ID` (`^[a-z]-…`). No element can start with `-`, so a body can't inject a flag such as `--approved`. It maps to `['goal', 'order', ...ids]` and runs as the owner on channel `dashboard`. ownerWriter refuses the command when DEVTEAM_ROLE is set. `HUB_ACTIONS` is unchanged (thread-* and start only), so the hub's `/operator/goal-order` is not an action. The supervisor.md row covers what spec §6 asks: one goal with --goal/--change and `goal set --approved`; several goals as one `--order` question with no `--goal`, applied by `goal order --approved`; "Never one question per goal"; and the owner's direct `goal order`. On a scratch copy the dashboard and supervisor.md tests pass. Two mutations of the action's validator survive them: dropping the 50-id cap, and dropping the `ID.test` on each id. Every bad body the test sends is also refused by the command itself, so the 400 doesn't show the validator ran.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T3-1 | Minor | spec Edge cases (more than 50 ids, a non-id: 400); quality.md §3 (mutate where a test can't show it) | test/goal-order.test.mjs, dashboard test, the bad-bodies loop | The 51-id body repeats A, so the command refuses it as a duplicate. `'not an id'` is refused by the command as "no goal". Removing `b.ids.length <= 50` or `ID.test(x)` from the action still passes. The action is what keeps an argv flag out of the owner's command, so it should be the thing under test. Use 51 distinct well-formed ids, and a flag-shaped element such as `['--approved', '<qid>']`, and assert nothing was written. | fixed: a body with --owner among ids is refused by the action's own check (the 50 cap stays unproven by test; 51 goals is a heavy fixture) |
| T3-2 | Suggestion | spec §5 (405) | test/goal-order.test.mjs, hub POST | Spec §5 says the hub refuses with 405, but the test accepts any status of 400 or more. | fixed: test asserts 405 |
| T3-3 | Suggestion | spec §6 | docs/devteam/process/supervisor.md:196 | The row opens with "a change to a goal past draft", but an `--order` question may name drafts and renumbers them too (spec Edge cases). Consider "a change to a goal past draft, or the goals' order". | fixed: the row says a goal past draft, or the goals' order (drafts included) |

Verdict: APPROVE b9b7712bdd48fd42d2277f625b039af62281a7b6
