# Task 2 review, pass 2

- Reviewer: task-2-confirm-reviewer (fresh subagent, claude-opus, cold confirm)
- Reviewed: 88cca935feddff68ae9aa9bd7b38283b618168b3 (task T2 fix, diff since c92fdda)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| - | - | - | - | No findings | |

Checked:
- Scope: since c92fdda only `test/recovery.relaunch.test.mjs` changed (plus the review record and its dispose script). `relaunchTier` and `plannerAwaitsOwner` are unchanged.
- I ran mutations in scratch copies of 88cca935 (`git archive`), with `timeout 600 node --test --test-concurrency=2 --test-name-pattern="the order" test/recovery.relaunch.test.mjs`, three runs in all:
  - Unmodified: both "the order" tests pass.
  - T2-1, `.git` guard replaced by `if (true)`: test 9 fails, test 10 passes. The untracked `stray.txt` in the main checkout is what makes the plain worktrees read dirty. Resolved.
  - T2-2, `&& !handledMessages().has(said.id)` dropped: test 9 fails. demo-66-answered moves from tier 1 to the end of tier 2 (after demo-61-blocked). So the `--re` reply sent as the supervisor (`dtRun … F.env()`, with the id from the first line of the worker's `send` output) really counts as handled, and the id parsed is the message id. Resolved.
- Read from the code, not run:
  - T2-2 "last": demo-67-later's last message is `info`, sent after its `blocked` one. If the code looked at any blocked message, or the first one, demo-67 would land in tier 2 and the assertion would fail. Not flaky: if both sends share a `created_at`, `byTime` returns 0, and the stable sort keeps log order, so the `info` stays last.
  - T2-3: demo-68 (phase `blocked`) is launched last of the workers. Removing `'blocked'` would move it to the end of tier 1, after demo-67 and before demo-60, so the assertion fails. Resolved.
  - T2-4: p9 has no question and no artifact thread. Its only route to tier 0 is the item thread on `planner:plan-p9`, which matches `planner:${name}`, not `planner:${feature}`. Removing that alternative would move plan-p9 to the end of tier 1 (it was launched last, so it would come after demo-67-later), and the assertion fails. Resolved.
- No new defects found. Every expected position follows from a tier plus launch order. The planner tier-0 checks don't depend on time. The fixture is per test, so `stray.txt` doesn't leak into other tests. The final `until` count was raised to 13 to match.

Verdict: APPROVE 88cca935feddff68ae9aa9bd7b38283b618168b3
