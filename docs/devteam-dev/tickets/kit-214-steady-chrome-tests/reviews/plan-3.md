# Plan review, pass 3

- Reviewer: spec-plan-reviewer-3 (fresh subagent, claude-opus-5-5)
- Reviewed: dc3b6c1d6528e45157df473a5e4c0ebf2a8c4299 (plan.md, diff since 4bfba63)

Checked against plan-2's findings, spec.md at the same head, test/lib/chrome.mjs close() and devteam.mjs paneAnswer/tmuxAsync. Nothing was run.

- P2-1: fixed. `const closing = chrome.close(); chrome.proc.removeAllListeners('exit'); await closing` removes the listener `close()` registers synchronously (chrome.mjs:52), so `exit` never reaches `done()` and only the bound can end it. It matches spec § lib/chrome.mjs. The review focus no longer leans on the case for unref.
- P2-2: fixed. 160 polls at 0.05 s, `send-keys` and `-l` as whole arguments over `"$@"`, `gave-up` touched before the pass-through, and the absence asserted. It matches spec § pane-question.
- Spec and plan agree on the teardown cases and on the wrapper, apart from P3-1, which both carry.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P3-1 | Important | spec Intent; done-when 3 and 4; same as spec F3-1 | plan.md:40 (Task 1 step 1, no exit ever reported, \"after more than 8 s\") | The lower bound is the 3 s plus 5 s bound itself, checked strictly. Node timers run off libuv's cached, whole-millisecond loop time and can end a millisecond or more early as measured by Date.now around the call, so an idle child can read 7999 or 8000 ms and fail with nothing wrong. Use a lower bound that only separates the bound from an exit at about 3 s (for example at least 6 s). | fixed |
| P3-2 | Minor | spec § pane-question (fails saying the gate timed out, not 200 versus 409); F2-2 | plan.md:74 (Task 4 step 1, \"The test asserts that gave-up doesn't exist\") | The plan doesn't say where the assertion goes. If the gate gives up early, step 3's wait for the input box or step 4's 409 check fails first, with a timeout or 200 versus 409, which is the failure F2-2 meant to replace. Check for `gave-up` before the status assertions, and make step 3's and step 4's waits fail at once when it appears. | fixed |
| P3-3 | Minor | P2-1 (run the case against main's copy as well) | plan.md:44 (Task 1 step 2) | Step 2 runs the file against main's chrome.mjs but states and quotes only the SIGSTOP case's result. P2-1 asked that the no-exit case's result at main (cancelled, or a hang to the timer) be shown too, so verification.md proves that case fails without the fix. | fixed |

Verdict: CHANGES dc3b6c1d6528e45157df473a5e4c0ebf2a8c4299
