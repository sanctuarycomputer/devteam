# Task review, task 4, pass 2

- Reviewer: task-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: 6c04aded4714be9816577ac78771e7a3a22bbaf7 (the fix for T4-1)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

T4-1 is resolved. `perPass` is now `items.length ? median(perTicket) : null`, so with no spend items there is no per-pass estimate. Review-depth and tighter-specs both sit under `if (perPass !== null)`, so neither is made. The new test 'no spend items: no price per review pass, so no review suggestions' passes on 6c04ade (`test/efficiency-data.test.mjs`: 18 pass, 0 fail, 0 skipped). In a private detached worktree at 6c04ade with only that line set back to `median(perTicket)`, test 18 fails (17 pass, 1 fail) and returns `eff-review-depth-s-normal` at `usd: 0`, the same output pass 1 reproduced. So the test would fail without the fix. The test does not push tighter-specs separately, but tighter-specs uses the same gate. The sort change in the diff (plain id comparison) belongs to T4-3 and breaks nothing.

Verdict: APPROVE 6c04aded4714be9816577ac78771e7a3a22bbaf7
