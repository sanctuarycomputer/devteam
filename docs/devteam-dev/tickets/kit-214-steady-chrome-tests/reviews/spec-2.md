# Spec review, pass 2

- Reviewer: spec-plan-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: 4bfba6355aa88690b3461fdc358626a91c6d8c3a (spec.md, diff since 004dc98)

Checked against spec-1's findings, the code they cite (test/lib/chrome.mjs close(), test/dashboard.test.mjs 2026-2120, docs/devteam/dashboard/index.html load() at 5947-5972 and the viewer check at 6403, devteam.mjs paneAnswer and its tmux execFile timeout) and .github/workflows/test-stress.yml. Nothing was run.

- F1-2, F1-3, F1-4, F1-5, F1-6, F1-7, F1-8, F1-9: fixed as written. The viewer-reload wait now counts landed `/api/data` (dashboard) and `/api/view?` (viewer) reads, the endpoints that call `avFpSeen`; two landed reads give a reload the first set off a full 10 s tick. The test has a 240 s timeout and lives in dashboard.test.mjs, which done-when 5 excludes, so the longer wait breaks no bound. F1-4 is answered by "not known" plus the Node 22 stress run the new ruling allows.
- Ruling m-20261115-185043423: § test-stress.yml matches it. The input is `type: choice` (20, 22, 24, default 24). It reaches setup-node through `with:` and the step through `env:`, and `run:` holds no `${{`. A scheduled run has no inputs and falls back to 24 through `|| '24'`. "Nothing else in the file changes" keeps `contents: read`, the concurrency group, `timeout-minutes: 240`, the triggers and the in-script repeat and load checks. No test or kit script reads an env var called `NODE`. The two dispatches on one ref queue in the concurrency group (cancel-in-progress false), and neither cancels the other.
- F1-1 is fixed in the design (`done()` unrefs and removes its listener), but the test written to cover it can't fail. See F2-1.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Important | done-when 1 (a check that would fail if the work were wrong); F1-1 | spec.md:177 (§ lib/chrome.mjs, close()) | The "exit never reaches close()" case removes the ChildProcess's `exit` listeners and only then calls `close()`. But `close()` registers its own `proc.once('exit', done)` when it is called (chrome.mjs:52), so the removal doesn't touch it. The 3 s SIGKILL ends the stopped Chrome, `exit` arrives, and `done()` runs at about 3 s. That happens at main too, so the case passes with or without the 5 s bound. Fix: call `close()` first and then remove the listeners in the same synchronous turn (close's executor has registered by then), or stub `proc.once` for `exit` before `close()`. At main the case then hangs and is cancelled, which is what it has to show. Also, the case can't show the `proc.unref()` either: after the SIGKILL, libuv reaps the child and closes its handle whether or not anyone listens. So "the teardown test covers it" is true of the bound only. Say that, or drop the claim for unref. | fixed |
| F2-2 | Minor | F1-8 ("fails with a cause that reads right") | spec.md:202 (§ pane-question) | After 8 s the wrapper gives up and passes the digit through. On a slow run the key then lands, and the test fails on the final status (200 where 409 was expected), which reads like the original flake. Have the wrapper write a `gave-up` file when it times out, and have the test assert that the file is absent, so the cause says "the gate timed out". | fixed |

Values and refusals (strategy.md): unchanged from spec-1. The workflow change adds an input that can only be 20, 22 or 24, and keeps every limit kit-216 set. It touches no authority path (P5, R1).

Verdict: CHANGES 4bfba6355aa88690b3461fdc358626a91c6d8c3a
