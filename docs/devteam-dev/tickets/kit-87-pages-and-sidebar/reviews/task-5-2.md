# Task 5 review, pass 2

- Reviewer: task-reviewer 5b (fresh subagent, claude-sonnet-5-5)
- Reviewed: 890d9a88ddb61c10b1b307243f68eab2ef23383a (c2a4774..890d9a8)

I read the rules, the previous record, and the fix diff (index.html and test/dashboard-pages.test.mjs). T5-1 is ADDRESSED: onPress (index.html, bindFleetSwitch call) clears the error, then Drain on a parked fleet sets "Parked: Run first, then Drain" and redraws without posting; Drain while draining and Park while parked (no confirm shown, and onConfirm while parked just closes it) also post nothing, so the mode stays the data's. Run on a running fleet still posts nothing and Run on a held fleet still resumes. The tests cover Drain while draining (no post), Drain on a parked fleet (no post, the .err text, mode park). T5-2 is ADDRESSED: postFleet records the pressed button's slot and data-fleet, and fleetRefocus runs after drawFleet in onOk and onError (it declines when the owner has moved focus elsewhere); the tests assert focus on Drain after the drain and on Run after the refusal. The refusal path is still exercised: the test now presses Run on the parked fleet with the stub failing, which is a real post that gets a 500; it asserts the error in .fleet-switch .err, the mode back to park, one post for the refused press, and that a redraw keeps the error. I ran no tests.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| - | - | - | - | none | |

Verdict: APPROVE 890d9a88ddb61c10b1b307243f68eab2ef23383a
