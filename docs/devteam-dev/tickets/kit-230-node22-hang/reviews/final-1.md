# Final review, pass 1

- Reviewer: final-reviewer (fresh subagent, claude-opus)
- Reviewed: 3338a081016c6cbb4528833b8452797dcb402b31 (the whole branch)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | L-TEST-2; spec §Approaches A ("after the hook has finished, the error is caught and written to stderr") | test/hub-overview.test.mjs:39-40 (`cleanup().add`, the `state === 'done'` branch) | No test covers the error path for a step added after cleanup has finished, where the error is written to stderr as `cleanup after the test: …` instead of becoming an unhandled rejection. I replaced that `p.then(...)` with `return;` and all 4 cleanup tests still passed. The fix is a test that adds a throwing step after `run()` and checks stderr (or checks there is no `unhandledRejection`). This is a diagnostics-only path in test code, so it does not block. | |

Checked against the done-whens and found sound:
- **Hook order.** Every `t.after` in the file now goes through `defer`; `t.after` remains only inside `defer` itself. In every test, reversing the order stops processes and servers before their folders are removed:
  - Chrome test: the `q`/`other`/`p`/Chrome closes, then `b`/`a` stops, then `rm base`.
  - hub-wait test: `h2` kill, `holderB`, `rm M2`, `h1` kill, `holderA`, `rm M1`, `rm imageKit`.
  - Every test's first `defer` runs while its body is running.
- **Workflow.**
  - `include` sets `test_timeout` for both parts on 20, 22 and 24, and leaves it empty on 18.
  - The explicit `name:` keeps the 8 job names unchanged (seen on all three runs).
  - Each of the three `node --test` steps has `timeout-minutes: 12`.
  - The `ps -eww` step runs only on failure (`if: failure()`) and was skipped in all 24 jobs.
  - There is no `--test-force-exit`.
  - Step budget for rest: 12 + 12 minutes plus setup, under the job's 30.
- **Done-when 4.** Only `.github/workflows/test.yml`, `test/hub-overview.test.mjs` and this ticket's records changed.

## What I ran

All in the review worktree from `review-worktree … --name final`, which I have since removed.

- **The whole file, once, on node@22.23.4 at `--test-concurrency=2`:** 19/19 pass in 47 s, and the file exited on its own.
- **The injected failure (my second and last non-cleanup run).** I made the Chrome test's first step (line 288) throw `ENOTEMPTY` and ran `--test-name-pattern=Overview.in.Chrome` on 22:
  - `not ok` with `hookFailed` and the injected error; the runner exited 1 after 19 s.
  - Nothing was left running from the test's folder (`devteam-hub-ov-JlOZDa`).
  - Some chromium renderers were still alive. I traced them by pid to another session's `browser-view-page.test.mjs` Chrome, not this run.
  - I reverted with `git checkout` and removed the folder the injected failure left behind.
- **Mutations, each run with `--test-name-pattern=cleanup` on 22.** Every mutation below made the cleanup tests fail:
  - dropping `.reverse()`
  - `first = e` (keeping the last error instead of the first)
  - dropping the wait on late steps
  - dropping the `Promise.race` per-step bound
  - not tracking late steps
  - dropping steps added after `run()` has finished

  One survived: silencing the stderr report for an error after `run()` has finished (F1).
- **Hook order probe** (scratch file, three `t.after` hooks, the second throws, on 22 and 24): hook 3 never ran and hooks 1 and 2 ran in the order added. This confirms the spec's cause.
- **CI, read-only (`gh run view`).** Runs 43682089828, 43682576720 and 43683128889 were 8/8 green each, at 0c3d214, b3402a7 and c1cd0f1. Those commits differ only in ticket records, not code.
  - Job durations match verification.md exactly.
  - The logs show `--test-timeout=600000` on 20/22/24, and an empty value on 18 (`node --test  --test-concurrency=8`).
  - On `kit (22, rest)` the 4 cleanup tests and "the Overview in Chrome" pass on all three runs.
- **The PR body** carries the cause, as done-when 2 requires.
- **Not rerun:** verification's E (the 10-run loop) and the per-Node `--test-timeout` probe (A). The run budget didn't allow them; A is consistent with what CI shows.

Verdict: APPROVE 3338a081016c6cbb4528833b8452797dcb402b31
