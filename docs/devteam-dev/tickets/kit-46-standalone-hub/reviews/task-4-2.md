# Task 4 review, pass 2

- Reviewer: task-confirmer (fresh subagent, claude-opus)
- Reviewed: ffbb787c809dbb502e84bdd4a1196bd32501030e (the fix, diff since bda6057's parent e95e26b)

- G1 (Important, socket idle timeout is no deadline): fixed. One 3 s `setTimeout` covers the whole read. `done` clears it, destroys the request and resolves. Repeat `done` calls (over the cap, then `end` or `error`) are harmless. `timer` and `r` are both bound before any callback can run. The timer is cleared on every path, so `machine status` exits promptly.
- G2 (Minor, cap counted UTF-16 characters): fixed. The code reads Buffer chunks, counts `c.length` bytes and decodes once with `Buffer.concat`. No test covers it (H2).
- G3 (Suggestion, answered then silent reported DOWN): fixed. `answered` turns the deadline, and a request error after the headers, into `up, not a hub`. No answer, or a refused connection, is still `DOWN`.

Ran `kt.sh --test-name-pattern="names the hub's kit" test/machine.test.mjs` in the worktree: pass, and the earlier cases are unchanged. Mutations, each in a scratch copy of HEAD, devteam env stripped, under `timeout 90`:
- M1: the deadline removed and the old `timeout: 3000` socket timeout restored. The drip case never ends, and the run was killed at 90 s. Detected only as a hang (H1).
- M2: the deadline always resolves `DOWN`, ignoring `answered`. Fails: actual `DOWN`, expected `up, not a hub`. Killed.
- M3: the cap counts `c.toString().length`. Passes. Survives (H2).
- M4: `res.on('error')` removed. Passes. On Node 18.20.4, destroying the request mid-body emits `aborted` and `close` and no `error`, so the listener is defensive only. This is not a finding.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| H1 | Minor | quality §3 mutate-to-prove (a RED that fails, not hangs) | test/machine.test.mjs "status names the hub's kit…", drip case | Without the deadline, `hubLineOf`'s `execFile` waits forever on the dripping server. The test has no `timeout` option, and `execFile` has no `timeout`. The `< 8000` ms assertion therefore never runs, and a regression hangs the file rather than failing it. Add `timeout: 10000` to that `execFile` (or to the test's options), so the regression fails with a message. | noted (Minor: the drip case still fails, by the run's own timeout, if the deadline goes) |
| H2 | Suggestion | spec Edge cases ("read capped at 64 KB") | `hubLine` byte cap; test cases | G2's byte count has no test: every case is ASCII, where characters and bytes are equal. Counting characters again passes the tests (M3). A case with, say, 30000 × "€" (about 90 KB of bytes, 30 K characters) in a valid hub body, expecting `up, not a hub`, would pin it down. | noted (Suggestion) |

Verdict: APPROVE ffbb787c809dbb502e84bdd4a1196bd32501030e
