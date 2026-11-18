# Plan review, pass 2

- Reviewer: plan reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 67053bee52d1f9b4ae0793d7cb63e3be76dc224a (plan.md)

I checked each plan-1 disposition against the plan as it stands. I also checked the plan against the revised spec, the ticket (done-when 1 is now amended to 84 days), shell.md and today's index.html and devteam.mjs. Every disposition is carried out:
- P1: the Supervisor row comes from `/api/threads`' `supervisor.question`.
- P2: `heartbeatDays` is in T2's interfaces, with a fixture in `kit-84`'s shape.
- P3: `kit-88`'s `howItChanges` is kept, and the test asserts its `data-thread-on`.
- P4: `held_by`'s question is looked up and ignored when it has a default.
- P5: `ol.steps` is compared across Overview, Goals and the peek, on g0, g2, g3 and g6, whose expected words match `GOAL_STEP_WORDS`.
- P7: the names from `kit-87` and `kit-88` are listed.
- P8: `dashboard-peek.test.mjs` runs alone in T4.
- P9: Status's other rows and the Goals sub-line are asserted.
- P10: the direct-dependent fixture is added, and the Inbox page is added only if absent.

The counts hold. Active 6 is g0, g1, g2, g3, g6 and Upkeep, with Met 1 and Let go 1. The Overview rows are the same five goals. Numbers has 11 or 12 tiles in the spec's order. The step bar is checked in four states. Every file is in the touches. The remaining findings are fixture and naming gaps a builder would trip on. One is P6's id clarification, which the revision didn't carry over. None of them leaves a done-when unproven.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P11 | Minor | the fixtures the tests use are set up | T2 Step 1 (init script); T3 Step 1 | The init script merges only `__patchData` into `/api/data` and `__patchHello` into `/api/hello`. T3's test also patches `/api/threads`' `supervisor.question` (to a dialog, and to `kind: 'limit'`) and makes `/api/hello` fail, so the pill reads `unknown`. Add both to the init script in Step 1: a `__patchThreads` merge and a switch that fails hello. | accepted, applied in T2 Step 1 at build: the init script patches /api/threads too and can make /api/hello fail on a flag |
| P12 | Minor | names match the code | T3 Step 3 ("Supervisor from `TL`'s `supervisor.question` as `askSet` keeps it") | `TL` (index.html ~5025) holds no supervisor field. `askSet` keeps the question in `ASK.q` (~5431), fed from `j.supervisor?.question` (~5472). Read it from `ASK.q`, or `askShown()`, so the row and the panel's ask agree. | accepted, applied in T3 at build: read ASK.q, where askSet keeps it |
| P13 | Minor | each test can reach what it runs | T2 Step 1 ("a vm case checks `heartbeatDays`") | The only block the vm part slices is `goal-block`. `heartbeatDays` is in neither marker block, so a vm case can't reach it. Put it inside the `goal-block` (or its own) marker block, or check it with `page.evaluate` in Chrome. | accepted, applied in T2 at build: heartbeatDays goes in the goal-block marker block beside goalBlock, so vm reaches it |
| P14 | Minor | fixture counts consistent | T2 Step 1 (g6 "an open goal-approval question"; "two open questions"); T3 Step 1 ("lists both questions") | It's unclear whether g6's goal-approval question is one of the "two open questions" or a third. Needs you's expected rows, the `.sum` count and which card carries the Next chip in T4 all depend on it. State the open questions in the fixture and their expected rank order. | accepted, applied at build: g6's goal-approval question is a third open question; the summary, Needs you and Next chip assertions count three, ranked as /api/data gives them |
| P15 | Minor | the assertion names what is posted (plan-1 P6, not carried) | T4 Step 1 (POST body `{ action: 'correct', body: { id, reason, impact: 2 } }`) | plan-1 P6 noted that `body.id` is the impact's decision id: the form's key is `imp:<decision>`, and `imp:` is stripped (index.html ~3494, ~6326). It is not the goal's id. The revised step still writes a bare `id`. Say it is `g1.impact.decision`. | accepted, applied in T4 at build: body.id is g1's impact decision id (g.impact.decision) |
| P16 | Suggestion | fixtures match real data | T2 Step 1 (`pulse: { state: 'waiting', activity: [...] }`); T3 Step 1 (12 columns) | `helloPulse` gives `activity` as an array of `PULSE_DAYS` (84) daily counts. Say the patched `activity` has 84 entries, or patch only `state` and keep the server's array, so "12 columns" follows from the data. | accepted, applied in T2 Step 1 at build: pulse.activity fixture of 84 entries |

Verdict: APPROVE 67053bee52d1f9b4ae0793d7cb63e3be76dc224a
