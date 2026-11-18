# Task 5 review, pass 2 (cold confirm, diff-only)

- Reviewer: task-5 pass-2 reviewer (fresh subagent, claude-opus)
- Reviewed: f3be0c2 (fix diff b3a7f874..f3be0c2c; the review record commit ignored)

| Pass-1 id | Status |
|---|---|
| T5-1 | ADDRESSED: `GOAL_PEEK_READY(title, key)` adds `!document.querySelector('#drawer-body .loading')` and the key row in the first `dl.props` (`Opened` for a goal, `What it covers` for Upkeep), the wait dashboard-overview-goals.test.mjs uses. Probe (measureAt instrumented in place, restored): `#goal/<seeded>` at 1440 waited 8 polls, and when ready held there was no loading marker, keys `ID…Opened\|How it changes\|Title\|Outcome\|Horizon\|Preconditions\|Not in scope` and 3 section cards, so the stored rows and History are now measured. Upkeep's peek: no loading marker, keys `ID\|Status\|Hold\|What it covers\|How it changes` at all three sizes. Upkeep's peek draws in one go from DATA, so its key-row wait is enough. |
| T5-2 | ADDRESSED: `OV_READY` adds `!!document.querySelector('#overview .mosaic > i')`. With no hello, `ovMosaic` draws an empty `.mosaic`, so the clause really does wait for hello. Mutation: with `helloLoad` delayed 6s, the fixed `ready` waited 13 polls at 1440 and measured 84 cells. With the clause removed (and the delay kept), Overview was measured with 0 cells at all three sizes and the test still passed, so the clause is what holds the measure back. With a 1.5s delay the /api/data read was still slower, so 0 waits there is expected. |
| T5-4 | ADDRESSED: `title="${esc(s.label)}"` on the Goals card head badge (`goalCardHtml`, ~3450) and on Overview's row badge (`renderOverview`, ~5871), escaped like the text. The hunks at ~946 (comment), ~3450 and ~5871 are outside `devteam-layout` (46–206) and `devteam-shell-js` (1202–1474), and "the shell blocks are untouched" passes in dashboard-shell.test.mjs. Mutation: both titles removed makes "goals: tabs, two across, cards and Upkeep" (line 404, `["","Being built"]`) and "overview: header, …" (line 624) fail, rc=1. |

No new defect in the diff. The new assertions count 5 badges, which matches the 5 active goals in the fixture (`['g1','g2','g3','g6','g0']`), and `:not(.upkeep)` leaves Upkeep's card out.

Runs (rt90.sh, one file at a time, at f3be0c2, unmodified):
- test/dashboard-measure.test.mjs: rc=0, 4 pass, 0 fail, 0 skipped.
- test/dashboard-overview-goals.test.mjs: rc=0, 10 pass, 0 fail, 0 skipped.
- test/dashboard-shell.test.mjs: rc=0, 16 pass, 0 fail, 0 skipped.

| Id | Severity | Where | Finding | Disposition |
|---|---|---|---|---|

Verdict: APPROVE f3be0c2cd72bcb0e0d078f7a4f9b9a0499ba6039
