# Task review, task 1

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus-5-5)
- Reviewed: 963fb486f580345851323870e76d9d4c016cd87a (32fdd0f..963fb48)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Minor | spec Rounding: "`hours_per_point` sums the cycles' raw milliseconds, then divides and rounds to 2 places" (progress.md ruling: 2 places, not hours()'s 1) | test/efficiency-data.test.mjs 'per-week measures from known logs' | Every fixture's hours_per_point is a whole number (8, 4, 10, 20, 5), so a regression to `hours()`'s 1-place rounding, or to rounding each cycle before summing, passes the suite. One week whose answer differs at the second place (e.g. 3 tickets at 1h, 1h, 2h20m over 3 points = 1.44) would pin the ruling. | wont-fix: Minor; the 2-place rounding follows the spec and is visible in the code; deferred under the review cap |
| T1-2 | Minor | spec One read: the memo is "off and emptied in `finally`, so the server reads fresh on each request and the CLI's other commands behave as today" | devteam.mjs `dashboardData`; test '/api/data carries the same efficiency, read fresh on each request' | The freshness test changes only a spend line, never a review file, and nothing checks the memo is off after `dashboardData` returns. Dropping the `finally` reset passes the suite (entry re-creates the Map, so dashboard requests stay fresh, but every other server endpoint would then read a stale memo). A review file added between two `/api/data` requests, or a non-dashboard endpoint read after one, would cover it. | wont-fix: Minor; dashboard-data runs as its own process per request, so the memo can't outlive one; deferred |
| T1-3 | Suggestion | plan Task 1 Interfaces: memo keyed `${id}\0${src.ref ?? 'worktree'}` | devteam.mjs `ticketReviews` | The key also carries `src.repo?.name`, so the plan-approval read at ~9191 (`{ ref, repo: R }`) and the `{ ref: b }` reads of the same ticket are two misses. Correct (different sources may read different repos) and the read-count test passes on the fixture; noted only because "exactly one per ticket" then holds only while no linked-repo planned ticket is on the dashboard path. | wont-fix: Suggestion; noted |

Verdict: APPROVE 963fb486f580345851323870e76d9d4c016cd87a
