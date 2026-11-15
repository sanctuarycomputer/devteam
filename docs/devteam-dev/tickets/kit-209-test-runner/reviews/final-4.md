# Final review, pass 4

- Reviewer: final-reviewer-4 (fresh subagent session, claude-opus-5-5; cold confirm)
- Reviewed: e17235ca9f6b100781869b865b7362a483ee5c44 (the F3-1 fix since 59fcbd3)

- F3-1: confirmed fixed. The test now runs `--concurrency 2 --file-timeout 20 hang.mjs slow.mjs`. It waits `waitFor(pids.json, 30000)` and checks `run.alive()` before it destroys its end of the runner's stdout. The new fixture slow.mjs passes after 6 s, not 1.5 s.
- Scope: `git diff 59fcbd3 e17235c -- test/run.mjs` is empty. Under test/, only test/run.test.mjs (5 lines in this one test) and the new test/fixtures/run/slow.mjs changed. The rest of the range is review records and verification.md.
- Order A, the usual one: slow.mjs ends after the pipe closes. hang.mjs writes pids.json about 1 s in, the test destroys the pipe, and slow.mjs ends at about 6 s. Its `say()` in `end()` hits EPIPE, and the 'error' handler runs `stopAll(141)`. That cleans up hang.mjs's tree, so the runner exits 141 and `allDead` holds. At the head, t.sh 24 passes 39/39 and t.sh 18 passes 38 with 1 skip (the compile cache, before Node 22.1). The test took about 6.3 s on each.
- Order B: slow.mjs ends before the pipe closes, because hang.mjs is slow to start. slow.mjs's output goes to a live pipe, which is harmless. The runner's next write is hang.mjs's watchdog line at 20 s (from hang.mjs's spawn). The timer callback's `say()` hits EPIPE, and `cleanup(entry)` kills the tree straight away. `stopAll` then sets `stopping`, skips the walk it already did (`entry.killed`), waits on `done`, and exits 141. The 45 s deadline covers that. I forced this order in a scratch copy, with slow.mjs's delay set to 0: it passed in 20.2 s.
- Red by chance: the test goes red only if hang.mjs takes about 20 s or more to write pids.json. Its watchdog then kills it first, so `waitFor` or `run.alive()` fails. Before F3-1 the margin was about a second. It is now about 20 s, and a startup that slow would be a broken runner anyway. A slow.mjs that ends between the wait and the destroy is order B.
- Green wrongly: green needs exit code 141 and every pid dead. Only the EPIPE handler gives 141. Without it, the write raises an unhandled 'error' event, the runner exits non-zero, and nothing is cleaned up.
- Mutations, in scratch copies made with `git archive HEAD` (the review worktree was never touched), with `process.stdout.on('error', …)` removed from test/run.mjs:
  - Order A, t.sh 24: the test fails, with `Error: write EPIPE … at say (run.mjs:386) at end (run.mjs:440)`, unhandled 'error' event.
  - Order B (slow.mjs at 0 s), t.sh 24: the test fails after 20.2 s, with `Error: write EPIPE … at say … at listOnTimeout`.
- Cleanup: the scratch folder is removed, and the review worktree is clean at e17235c. No dtr-fixture, hang.mjs or slow.mjs process of mine is left. The processes under review-kit-209-e17235ca-final4b belong to another reviewer, and I left them alone. I ran no kit command outside t.sh.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE e17235ca9f6b100781869b865b7362a483ee5c44
