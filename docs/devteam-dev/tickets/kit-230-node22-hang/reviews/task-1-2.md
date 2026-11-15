# Task 1 review, pass 2

- Reviewer: task-confirm (fresh subagent, claude-opus)
- Reviewed: b355604dd9d16d7cc1d8fc62b28e4ad2ed887bcd

Scope: diff only, `git diff f0763b62bbc7d9659159a701da073d085f2e8045 b355604dd9d16d7cc1d8fc62b28e4ad2ed887bcd -- test/hub-overview.test.mjs` (+8/-1), checked against the pass-1 findings and their dispositions, plan Task 1, and quality.md §3.

What I checked:
- **T1-1 is resolved.** Line 47 now reads `{ const e = await late[i]; first ??= e; }`. Every late step is awaited whether or not an earlier error was recorded, and the first error is still the one thrown. This matches the plan's Interface: `run` awaits a step added while it runs.
- **The T1-1 test is sound.** A main step adds a 100 ms late step and then throws. While `run` is running, `add` sends the new step to `late`, so the test exercises the fixed path. `assert.rejects(d.run(), /^Error: first$/)` checks `String(err)`, so it would catch the wrong error winning. `lateDone === true` would fail against the old line, because `run` used to reject before the timer fired. That agrees with the author's report that the test failed first. The leftover timer in the old code is 100 ms and ref'd, so it cannot hang the file.
- **T1-2 is resolved.** `defer(t, () => d.stop())` comes right after `startDashboard` in that test's `run()`, so if the test times out, the dashboard stops before the folder removals that `hubMachine` added earlier (last added, first run). `stop` is memoized (`stopping ??= …` in test/lib/kit.mjs:482), so the `finally`/`catch` calls that remain are harmless. The test's first `defer` (via `hubMachine`) is still synchronous at the start of the body, before any await, so `defer`'s single `t.after` is registered in time.
- **The fixes add nothing wrong.** The only other change in the diff is the pass-1 review record.
- **I ran the cleanup tests:** `mise exec node@22.23.4 -- node --test --test-concurrency=2 --test-name-pattern=cleanup test/hub-overview.test.mjs` gave 4/4 passing in 0.28 s. I did not run the whole file.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE b355604dd9d16d7cc1d8fc62b28e4ad2ed887bcd
