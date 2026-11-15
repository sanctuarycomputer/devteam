# Spec review, pass 2

- Reviewer: reviewer-spec-2 (fresh subagent, claude-opus)
- Reviewed: a49640c2aef7fb69762ea72a70a9d462b033ddb8 (diff from 8fb4c74)

Pass-1 findings, checked against the diff and the code:

- F1-1: fixed. `test/kit.test.mjs` is in the ticket's touches (`ticket show`), ruling m-20261115-200152909 is recorded, and item 7 names lines 827 and 853. Both lines pin the capped shape at a49640c.
- F1-2: fixed. The new "Who does what" section defers the reader words to kit-85: `capOf`, `active workers: N (no limit)`, the forecast's "open tickets in flight". These match kit-85's spec (lines 106-109) and plan (lines 78, 89-98). Contracts and Out of scope no longer call `null` an open question, and the lift word is `none`.
- F1-3: fixed. Check 4 bans a comparison or arithmetic operator right beside a key read. Plain reads (kit-85's pin, its equality check, its label, JSON output) are allowed. The behavioural `/null` and `/undefined` check backs it up.
- F1-4: fixed. Every `metrics` assertion runs on a fake cgroup.
- F1-5: fixed. Check 4 reads the settings JSON. `cmdSettings` with no `--get` prints `json(shown)`, so the key shows as present with the value `null`.
- F1-6: fixed. An invalid value counts as 0, never wider, and fails `validate`.
- F1-7: fixed. Check 5 covers the §4 "under caps" row and the goalForecast comment. Check 6 covers planning.md §1's "at the current worker slots".
- F1-8: fixed. The fixture has 3 ready tickets, with subject `3 ready`, and the suggestion names all of them (`ready.slice(0, 5)`).
- F1-9: fixed. Check 3 states the expected findings at limit 9 (memory-full) and at limit 3 (neither). See F2-1 for one precondition.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | done_when 3 | spec check 3 ("With the limit at 3 (no room): … neither `memory-full` nor idle-capacity (nothing would start anyway)") | memory-full also fires on `idlePlanning` (devteam.mjs:11571, `memFull && (idlePlanning \|\| …)`), whatever the worker limit. The check needs a goal for `planner beta --goal <g>`. If that goal counts as waiting for a planner (a fully defined draft goal, or a ready goal with an unplanned feature, devteam.mjs:11554-11563), memory-full shows at limit 3 and the assertion fails. A planner would start, so "nothing would start anyway" would be false. A goal added the way memory-ceiling.test.mjs adds it has no priority or baseline reading, so its definition is incomplete and it doesn't wait. Say so: the goal must not be waiting for a planner. | |
| F2-2 | Minor | done_when 5 | spec items 1-8; check 7; Contracts | Rev 1's R6 changed the memory-full finding's suggestion. Rev 2 drops that and defers to kit-85's words, but kit-85's spec and plan don't change the suggestion. It still says "if this keeps happening, lower max_active_tickets, your own setting" (devteam.mjs:11571). Under the new default there is no limit to lower. The supervisor.md row will say "set or lower … through the settings chore" while the finding says "lower". Either keep the reword in kit-86 (memory-ceiling.test.mjs:58's `/lower max_active_tickets/` still matches "set or lower max_active_tickets") or record that the words stay as they are. | |

No new Critical or Important defect. Strategy assessment as in pass 1. The change narrows kit-86 to the default, the missing and invalid cases, status and hello, and docs (P6 holds).

Verdict: APPROVE a49640c2aef7fb69762ea72a70a9d462b033ddb8
