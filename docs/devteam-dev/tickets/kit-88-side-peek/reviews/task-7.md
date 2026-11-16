# Task 7 review, pass 1

- Reviewer: task-7 reviewer (fresh subagent, claude-sonnet)
- Reviewed: 157b0ba2b6539cb0a31d995f8e9cf3ce2e8c00b2 (range 873f2e58..157b0ba2)

Spec §2.1 and §5 met. The change is two files: the peekHide edit in docs/devteam/dashboard/index.html and the T1 subtest in test/dashboard-peek.test.mjs; neither shell block changed, and `--dur` and `--ease` are used, not redefined. getAnimations() on the drawer flushes pending style, so the transform transition that removing peek-open starts is reported at once. Reduced motion (--dur 0) still returns hide() before it. A reopen still cancels the hide through PEEK_HIDE.cancel(), which clears the timer and the net and removes the listeners. The safety net is kept. A repeat close returns early, so there is no double hide. test/dashboard-shell.test.mjs run through gate: exit 0, 16 of 16 pass.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec §2.1 | test/dashboard-peek.test.mjs (RECORD, cl.remove) | The Escape and scrim subtest records `sliding` inside a wrapped classList.remove, so a page that stops calling classList.remove for peek-open fails the test with "peek-open removed" and no pointer to the cause. The subtest also no longer polls "shown while it slides out" at all; the check is now event-driven as the carried item asks. Fine, only a diagnostics note. | wont-fix diagnostics only: the subtest still fails, naming the step; the page's one removal path is classList.remove |

Verdict: APPROVE 157b0ba2b6539cb0a31d995f8e9cf3ce2e8c00b2
