# Task 2 review, pass 1

- Reviewer: task-2 reviewer (fresh subagent, claude-opus)
- Reviewed: b208951 (Task 2, 51d8156..b208951)
- delta-3 F1: not yet in scope (Task 3)

Spec compliance: ❌ Met and Let go cards show the goal's creation date as the "when" (T2-1); a test outside the touches breaks and nobody has flagged it (T2-2)
Quality: the tabs, hash routing, step bar adapter and heartbeat are sound, and three mutations each made the Chrome or vm test fail. One data field is wrong and one break went unreported.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-1 | Important | spec §3 Met and Let go ("badge, title, when, the reason or the measure line") | index.html `closedGoalCardHtml`: `const at = g.updated_at \|\| g.created_at` | `/api/data`'s goals have no `updated_at`. `goalView` spreads the folded object, which carries `created_at`, `created_by` and `updates: [{ at, … }]` (devteam.mjs ~1575, ~11426). So every closed card says "met <date opened>" or "let go <date opened>", which is the wrong date. The test asserts only /Met/ and /Let go/, so nothing catches it. Fix: take the time of the last `updates` entry that set `status` to met or abandoned (or that carries the let-go decision). Assert the date in the test with a fixture whose goal is created and closed at different times, for example a hand-written status line with an earlier `created_at`, or a check that the date is not `created_at`. | |
| T2-2 | Important | touches constraint ("files only from the ticket's touches"); plan T4 Step 4's precedent: a break outside the touches is a design-change message | test/next-step.strategy.test.mjs:261 and :263 (not in touches, not in T5's list) | This task breaks two assertions: `document.querySelector('#strategy-link').getAttribute(…)` (the link is gone, so this throws on null), and the goal card head matching `/priority 1 · moves a number the project watches/`. The head now reads "impact · priority n", which is the implementer's own reorder. Spec §3 says the card "keeps today's head", and today's order is priority first. Neither break is in the report. Fix: restore today's head order (priority · impact), which removes the second break, and send the supervisor a design-change message about line 261 so the touches can grow or the plan can move it. The same applies to test/dashboard-peek.test.mjs:1332, which clicks a card's `[data-hold-id][data-mode="let-go"]`. That one is already anticipated by plan T4 Step 4, so list it in the same message. | |
| T2-3 | Suggestion | spec §3 Upkeep ("Its click opens Upkeep's peek") | index.html `upkeepCardHtml` `data-open="goal/upkeep"` | Until T4, `#goal/upkeep` goes to `openGoal('upkeep')`, which shows the not-found peek. Upkeep's only hold control was removed in this task. T4's test should click the Upkeep card and assert Upkeep's peek with its Hold row. | |
| T2-4 | Suggestion | | index.html `bindTabBar($('goals'), …)` | When a peek is open over Goals, a tab click builds `state = {}` and drops `th` and `t`. The page head in `HERE.page` keeps them. | |
| T2-5 | Suggestion | | index.html ~555–564, the page's unscoped `.steps` rules | These rules copy the block's step-bar rules at equal specificity, and they come later in the page. So the done/now colour check passes on the page's copy. Remove them once Overview is ported (T3), so the check pins the block's rules. | |

Confirmed: the failure in test/dashboard.test.mjs "threads on the dashboard page" comes from line 3277 `shiftClick('#goals h2')`, and that heading is removed by this task as spec §7 requires. Task 5 handles it. The test's other Goals selectors (`#goals-list [data-subject=…]`) still resolve.

Mutation checks were run on private copies, each with 0 skipped and each making the tests fail:
- (m1) The `showHead` line that reads `gt` was removed. The Chrome test failed on "Back shows Active".
- (m2) `renderOoda` was made to reset `GOALS_TAB = 'active'` on every poll. The Chrome test failed (the tab does not survive the 300 ms polls).
- (m3) `heartbeatDays` was made to drop `failed`. Both the vm case and the Chrome test failed.

Verdict: CHANGES b208951f09986defe1cdfe1765e4d3423355707a
