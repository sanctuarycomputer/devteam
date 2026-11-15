# Plan review, pass 2

- Reviewer: reviewer-plan-2 (fresh subagent, claude-opus-5-5)
- Reviewed: f38b5ea7f5e078d98e08bc8e8af0337bbacc8e19 (diff from 34ad10d)

I ran Task 2's code in a scratch copy that imports nothing from the kit. It ran on every pane in the plan and in the existing third test of `test/accounts.supervisor.test.mjs`, with lines trimmed, empty lines dropped, and the last 15 kept, as `paneWaitingIn` does.

- Boxed A, B and C give one digest. Boxless 1, 2 and 3 give one digest, including `1.2M tokens` and the shell line going away. The tail is found in all six.
- The echo, more-reply and typed-line panes each give their own digest. The incident's stuck pane stays the same.
- Case 3(a) and case 3(b) read as busy over all lines. Today's bottom 8 don't hold the tail in 3(b), so the plan is right that it passes today.

How each pass-1 finding stands:

- P1 (Important) is fixed. `step` redraws, waits for that pane's own `\r`, then checks `tries` (1, then 2), and after step 3 checks that the record is gone. This matches `agent()`, which empties the keys file on each redraw (test/lib/accounts-fixture.mjs). The record survives the window being recreated, because it is keyed by session and window name.
- P2 (Important) is fixed. The guard is `lines.some(...)` over every captured line. Case 3(b) is added, and Risks is corrected.
- P3 (Important) is fixed. `paneNorm` takes out the `PANE_SHELL` phrases with a global copy, built at module load from a const declared above it (~2847, before `squash` at ~2891), so there is no temporal dead zone. Redraw C and the third boxless redraw drop the shell.
- P4 (Minor) is fixed. Risks now says the change can add a press on an idle empty prompt.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Minor | none | plan.md Task 1, run note | The note says that on today's code the boxless case also fails at step 2. The test is one `test()` that stops at its first failed assertion, so on today's code case 1 fails at step B and case 2 never runs. The red run still proves the fix is needed. Only the expectation is worded too strongly. | |

Verdict: APPROVE f38b5ea7f5e078d98e08bc8e8af0337bbacc8e19
