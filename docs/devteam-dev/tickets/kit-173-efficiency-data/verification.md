# kit-173 verification

Code head verified: `5c022cec901df38d923cf2597880584bcd62e642` (PR #284), with origin/main merged in (kit-202, then kit-205 at ca78a8a). Its last code change is dc8522b: test-only fixes for final-1's F1 to F5. Commits after it add only this ticket's records.

Local runs go through `devteam.mjs gate test -- node --test --test-concurrency=2 test/efficiency-data.test.mjs test/components.test.mjs test/dashboard-data.test.mjs`: at a1e4b70 the gate passed in 114.5s, pass 31, fail 0. The same run at 98d8b0e, before kit-205's merge, passed in 66.7s.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | Per week: 12 Monday weeks, per-week measures, first_pass (task-1/task-2/task-2-2 → 2 first passes), review files read once per request | the gate run above (`test/efficiency-data.test.mjs`) | `ok 1 - weeks: twelve calendar weeks, oldest first, ending this week`, `ok 2 - per-week measures from known logs`, `ok 3 - first_pass: ticket stages only, first passes, verdicts only` (task-1, task-2, task-2-2 → 2 first passes), `ok 4 - review folders are read once per request` (`review reads: 3`), `ok 5 - /api/data carries the same efficiency, read fresh on each request`. |
| 2 | The score against hand-computed answers; defect weeks; usd 0 → spend 1 | same run | `ok 6 - score against hand-computed answers` (67/58/72/55), `ok 7 - a defect week with the lowest dollars still sets best` (83/83), `ok 8 - one scored week with a defect scores rework only` (25), `ok 9 - usd_per_point 0 scores spend 1` (100). |
| 3 | Observe, waste, trials | same run | `ok 10 - observe is the window's metrics plus tokens_by_phase`, `ok 11 - waste is the open spend findings` (the newest observation's id, gone once set aside), `ok 12 - trials: spend trials and their state` (newest first, running/kept/dropped, start 1 → now 6, escaped_defects_since 1). |
| 4 | Suggestions: top five by dollars, plain words, ids SUBJECT_REF-safe, each kind's condition and effect | same run | `ok 13 - smaller model: same version one family down` (vm-loaded family table), `ok 14 - smaller-model condition and effect` ($10; none with settings sonnet at $25 or at 85%), `ok 15 - suggestion ids are valid thread subjects, cut at 110 characters`, `ok 16 - review depth and tighter specs priced per pass` ($12, $8; none without finals), `ok 17 - cache and costly tickets, the top five by dollars, and dropping out` ($58, $30, $20, $14.44, $14; k2 gone after its ack), `ok 18 - no spend items: no price per review pass, so no review suggestions`. The plain-words check (`plainWords`) and the id check against `^[a-z0-9][a-z0-9-]{0,110}$` run on the suggestions these tests produce. |
| 5 | Golden: dashboard-data.txt gains only `efficiency`; metrics.txt unchanged | same run (`test/components.test.mjs`, G1); `git diff origin/main -- test/fixtures/g1/` | G1 passes. The diff to `dashboard-data.txt` is 180 added lines (the `efficiency` block) and 0 removed lines. `metrics.txt` isn't in the diff. |
| 6 | test.yml passes on every job | `devteam.mjs gate ci -- gh run watch 43784884783 --exit-status --interval 60`; `gh run view 43784884783 --json conclusion,headSha,jobs` | Gate ci passed in 320.9s. Run 43784884783 at headSha 5c022ce is `success` on all 17 jobs, on the first attempt. Earlier, at a1e4b70 (before the F1 to F5 test fixes): `devteam.mjs gate ci -- gh run watch 43782881338 --exit-status --interval 60`; `gh run view 43782881338 --json conclusion,headSha,attempt,jobs` | Run 43782881338 at headSha a1e4b70, attempt 2: `success` on all 17 jobs (kit 18/20/22/24 × chain, rest 1/2, rest 2/2; chrome 1/2 and 2/2 on 22 and 24; tests). Gate ci passed in 71.2s. Attempt 1 failed only `kit (24, chrome 2/2)`: `test/dashboard-owner-action.test.mjs` subtest 5 `Done goes through once every record is done…` timed out waiting for the note to take focus. That test isn't this ticket's, and it passed on the same code on Node 22, on attempt 2, and in run 43782111428 at 98d8b0e (all 17 jobs `success`, before kit-205). |

`test/dashboard-data.test.mjs` (kit-84, now on main) passes 6/6 with this change. Its reads now run inside `dashboardData`'s review-read memo.

## After the merge of origin/main

`waste is the open spend findings` failed once after the merge, on a Monday. The cause was the test, not the merge. Its fixture merged eff-20-n on last week's Thursday, and metrics' costly-ticket finding counts a ticket merged within 7 days. So from Monday to Thursday, eff-20-n was a second costly ticket. Commit 3287f5e merges it in week 9 instead, at hour 13: after the trials' `since` and 11+ days old on any weekday. No expected value changed, and 18/18 pass.

## Rulings and order changes not in the approved spec and plan

- m-20261115-204118085: first-pass counts each task review (option B). This is in the spec.
- m-20261115-210241893: approve-spec and approve-plan at e102f9a.
- m-20261115-214203098: review rounds are capped. The task reviews followed it: task-4's Important finding T4-1 got a confirmation pass (task-4-2.md) covering only that fix.
- The build order changed several times (m-20261115-225221282, m-20261115-225723619, m-20261115-225917452, m-20261116-003745517). In the end the ticket follows only kit-202, which has merged. The code needs nothing from kit-85 or kit-205.

## Final review pass 1 (final-1.md, CHANGES at f654d43)

It found no code defect, only test gaps (F1 Important, F2 to F5 Minor). dc8522b fixes them in `test/efficiency-data.test.mjs` only. I re-applied each of the reviewer's surviving mutations in place, one at a time, and restored the file afterwards. Each one now fails the test it targets: `review depth and tighter specs priced per pass` fails when review-phase spend is dropped (F1), when the track letter is dropped from the final-record pattern (F4), when all tickets are counted instead of the 12 weeks' (F4), and when "more than half" becomes `>= 0.5` (F5). `cache and costly tickets, the top five by dollars, and dropping out` fails with `median()` in place of `floor(n/2)` (F2). `smaller-model condition and effect` fails when the excluded phases are cut to `final-review` and `spec` (F3). The unmutated file passes 18/18.

Nothing is deferred to beta.
