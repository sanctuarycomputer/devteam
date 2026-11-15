# Spec review, pass 3

- Reviewer: spec-plan-reviewer-3 (fresh subagent, claude-opus-5-5)
- Reviewed: dc3b6c1d6528e45157df473a5e4c0ebf2a8c4299 (spec.md, diff since 4bfba63)

Checked against spec-2's findings, test/lib/chrome.mjs close() (lines 39-54) and devteam.mjs paneAnswer and its tmuxAsync (14882, 10 s execFile timeout, default SIGTERM). Nothing was run.

- F2-1: fixed. `close()` is `closing ??= new Promise(executor)`; the executor runs synchronously, so its `proc.once('exit', done)` (chrome.mjs:52) is registered when `close()` returns, and removing the `exit` listeners in the same turn removes it. Node's ChildProcess keeps no `exit` listener of its own, and the other one removed (chrome.mjs:34, rejecting an already settled promise) is harmless. At main the case then loses its last ref after the 3 s SIGKILL and the file is cancelled, so it tells main from the fix. The unref claim is now limited to reading `done()`, which is correct (a reaped child's handle closes itself).
- F2-2: fixed. The wrapper writes `gave-up` before passing the call through, so the marker exists even if the dashboard's 10 s execFile timeout then kills the call. Spec and plan agree on 8 s, whole-argument matching, first call only, `armed` removed before waiting, and the `gave-up` assertion.
- Teardown cases: spec (done-when 1, done-when 6, § lib/chrome.mjs) and plan Task 1 describe the same cases with the same checks, apart from F3-1, which both carry.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F3-1 | Important | Intent (a failure should mean the dashboard is broken, not that the runner was slow); done-when 3 and 4 (green under stress and in test.yml) | spec.md:50 (§ lib/chrome.mjs, close(), \"after more than 8 s\") | The lower bound added by the F2-1 fix equals the bound it measures: 3 s SIGKILL timer plus 5 s bound is exactly 8 s, and the check is strictly more than 8 s. Node timers start from libuv's cached loop time and are kept in whole milliseconds, so measured with Date.now around the call they can end a millisecond or more early (staleness of the loop time when `close()` is called, plus rounding, across two chained timers). An idle child fires them almost on time, so 7999 or 8000 ms is a plausible reading and the case fails with nothing wrong: a new flake in a ticket whose point is removing them. The check only has to tell the bound from an exit at about 3 s. Fix: a lower bound well under 8 s and well over 3 s (for example at least 6 s), with the reason stated. | |

Values and refusals (strategy.md): unchanged since spec-1; the diff adds no authority path or new input.

Verdict: CHANGES dc3b6c1d6528e45157df473a5e4c0ebf2a8c4299
