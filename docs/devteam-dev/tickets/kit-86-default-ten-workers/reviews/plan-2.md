# Plan review, pass 2

- Reviewer: reviewer-plan-2 (fresh subagent, claude-opus)
- Reviewed: a49640c2aef7fb69762ea72a70a9d462b033ddb8 (diff from 8fb4c74)

Pass-1 findings, checked against the diff and the code:

- P1-1: fixed. T4 lists `test/kit.test.mjs:827` and `:853`, runs `test/kit.test.mjs` alone, and the file is in touches.
- P1-2: fixed. The T2 fixture sets `DEVTEAM_CGROUP` and `DEVTEAM_MEMINFO` on every `metrics`, `worker` and `planner` call, at 10 of 32 GB except in Case E.
- P1-3: fixed. T1 greps the whole kit and its tests (`docs/devteam test README.md`) for `max_active`, `capOf` and `no limit`. It records kit-85 as landed in the plan, and a file outside touches gets a `design-change` and `phase blocked`.
- P1-4: fixed. Case A reads the `settings` JSON.
- P1-5: fixed by design. The forecast and memory-full readers are kit-85's `capOf` (`Infinity + incident_slots` is `Infinity`). Case F bans raw arithmetic beside a key.
- P1-6: fixed. T5 and spec checks 6 and 7 carry `settings set max_active_tickets <n|none>`.
- P1-7: fixed. Case E asserts the planner refusal and the findings at no limit, at 9 and at 3.
- P1-8: fixed. T5 covers the §4 "under caps" row, planning.md §1 and the goalForecast comment (T3 step 5).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Minor | done_when 3 | plan T2 fixture ("one goal (for the planner and forecast)"), Case E at limit 3 | As spec-2 F2-1: memory-full fires on `idlePlanning` whatever the limit (devteam.mjs:11571). The plan doesn't say what the goal looks like. A fully defined draft goal would make Case E's "neither `memory-full` nor idle-capacity" at limit 3 fail. Pin it: add the goal as memory-ceiling.test.mjs does (no priority, no baseline, so not waiting), and say so. Also, "for the forecast" is stale, since no case asserts the forecast now. | |
| P2-2 | Minor | done_when 4 | plan T2 Case F regex | The second alternative, `(?:[<>]=?\|[-+*])\s*[\w$.?]*\.max_active_…`, matches the `>` of an arrow function (`(s) => s.max_active_tickets`), a plain read that isn't a comparison. There is none at a49640c and kit-85's plan shows none, but one in kit-85's landed code would fail Case F for no real reason. Exclude `=>` (for example `(?<!=)>`) or have T1 check for it. | |
| P2-3 | Minor | spec-2 F2-2 | plan T3, T4 (memory-ceiling.test.mjs:58) | No task changes the memory-full suggestion ("lower max_active_tickets, your own setting"). Under no default limit it says "lower" with nothing to lower. Whatever the spec decides, T3 should carry it, and line 58's regex (`/lower max_active_tickets/`) still matches "set or lower max_active_tickets". | |

Plan tasks stay within the ticket's touches and the ticket folder. No new Critical or Important defect.

Verdict: APPROVE a49640c2aef7fb69762ea72a70a9d462b033ddb8
