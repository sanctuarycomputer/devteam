# Task 1 review

- Reviewer: task-1 reviewer subagent

Scope: commit 63c23b6c, `docs/devteam/scripts/devteam.mjs` and `test/owner-setting.test.mjs`, against plan.md Task 1, Global constraints, Review focus 1 and Rulings and calls (build).

Checked and found sound:
- `OWNER_ASKABLE`, `askableProblem` (the four reasons are verbatim), `parseAskable` and `capOf` match the plan's interfaces.
- `loadSettings` pins both keys to main. It has its own `DEVTEAM_QUIET_ASKABLE` once-guard, and its warning matches the Global constraints text verbatim. The owner-settings line is unchanged and separate.
- Every reader of either cap in devteam.mjs was grepped (cmdReady text and mark, goalForecast, the two idle-capacity lines, memory-full). Each reads null as no limit. `ready --json` caps and `/api/data.caps` pass null through. The dashboard `index.html` is out of scope.
- The forecast `slots` follows the plan's rule: null gives the count of the goal's features' active, unmerged tickets, floored at 1.
- I ran `test/owner-setting.test.mjs` alone (DEVTEAM_* unset, scratch HOME, hub port 4399) and all 3 pass. Against the parent's devteam.mjs, all 3 fail.
- Mutation checks, each run on a scratch copy:
  - reverting the forecast change fails test 3;
  - reverting the fix-tickets suffix guard fails test 3;
  - reverting the component mark fails test 3;
  - reverting the memory-full condition still passes (T1-1);
  - reverting the fix-ready idle-capacity condition still passes (T1-2).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Important | plan Task 1 Step 1 (memory-full with null); Review focus 1 | test/owner-setting.test.mjs, the memory-full block of 'null means no limit wherever a cap is read' | The memory-full assertion passes without the change to memory-full's condition. The fixture's goal "Floor" is a draft with no open question, so `idlePlanning` is 1 (it waits for a planner), and `memFull && (idlePlanning \|\| ...)` raises memory-full whatever the cap arm returns. With the condition put back to `active < settings.max_active_tickets` (null), the test still passes. Only the detail text (`capText`) is really tested. Fix: make the arm the only path. Either keep the goal off the planner queue (give it a feature, or an open question) or assert the finding's detail lacks "waiting for a planner". Then confirm the test fails with the old condition. | fixed in 6f232c6: max_active_planners 0 keeps the draft goal off the planner queue, and memory-full runs with incident_slots 1 so neither branch holds under the old reading; mutation of the whole old condition fails the test |
| T1-2 | Important | plan Task 1 Step 3 ("both idle-capacity lines ... use capOf"); Review focus 1 | test/owner-setting.test.mjs, the idle-capacity block; devteam.mjs:12436 | The "exactly one idle-capacity finding, the plain one" assertion does not cover the fix-ready line's change. With `active = 1` and `incident_slots: 1`, the old `1 >= null && 1 < null + 1` is false, and so is the new code, so the test passes with the fix-ready condition reverted. The bug the change fixes (old code under null raising a false "fix ready" line) shows up when `active < incident_slots`. Example: `incident_slots: 2` gives `1 >= 0 && 1 < 2`, true. Fix: use `incident_slots: 2` in the null fixture (the control at cap 1 then reads `+2`), or add a case with no active worker. Then confirm the test fails with the old condition. | fixed in 6f232c6: incident_slots 2 for the idle-capacity check, so the old null reading raises fix-ready; mutation fails the test |

Verdict: CHANGES 63c23b6c0ee2e4a06c5e91bbee5f358814d02962
