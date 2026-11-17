# Final review, pass 4 (track b)

- Reviewer: final-reviewer-4b (fresh subagent session, claude-opus-5-5; cold confirm)
- Reviewed: e17235ca9f6b100781869b865b7362a483ee5c44 (the changes since 59fcbd3)

Scope: `git diff 59fcbd3 e17235c` touches `test/run.test.mjs` (the EPIPE test), adds `test/fixtures/run/slow.mjs`, and otherwise only review records and verification.md. `git diff 59fcbd3 e17235c -- test/run.mjs test/lib` is empty: no runner or lib code changed.

F3-1 (track a): confirmed fixed. The EPIPE test now waits for `pids.json` (up to 30 s), so the hung file is under way, then asserts `run.alive()` and only then destroys its end of the runner's stdout. The runner's next write is slow.mjs's report at about 6 s, or, if that came first, hang.mjs's timeout line at 20 s. Either way the write hits EPIPE while hang.mjs is still running. The old race, where slow-once could end before the pipe closed, is gone. Under heavy load, if hang.mjs times out before writing `pids.json`, the runner finishes and the `run.alive()` assertion fails. That fails red, never green.

Can it go green wrongly:
- It asserts exit 141, which only stopAll's EPIPE path produces. It also runs `allDead`, which checks that the file, its detached child and its tmux server are dead, that the killed file's port lock is freed, that the tmux socket has no server, and that the scratch folder is gone.
- Mutation 1 (Node 18): I removed the `process.stdout.on('error', …)` handler. The test fails: the runner dies on an unhandled `write EPIPE` at `say` ← `end`.
- Mutation 2 (Node 24): stopAll kept marking files `interrupted` but skipped `cleanup(e)`. The test fails at the 45 s deadline ("runner still running"). The watchdog doesn't rescue it, because it returns early once `ctx.stopping` is set, so the 20 s file timeout can't make it green. The SIGINT and SIGTERM tests fail too, as they should.
- Both mutations were restored with `git checkout -- test/run.mjs`. The worktree is clean at e17235c. I edited test/run.mjs in place, as a module the test spawns, and never ran it as an entry point outside the tests.

Shared-machine safety: after each run, mutated or not, no process had its cwd or args under this review worktree. That covers no `hang.mjs`, `slow.mjs`, `dtr-fixture` or tmux server. When the runner is broken, `runRunner`'s deadline SIGKILLs the runner's group, and `killFixtures` (a `t.after`) kills the recorded file, its detached child and its tmux server, after checking their args. Everything the fixtures start also ends by itself within 60 s. The port locks live in the test's own shared dir, which `t.after` removes. One thing does get left behind when the runner is broken: B4-1, below. It comes from the teardown, not from this diff.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| B4-1 | Minor | quality.md §3 (shared machine: leave nothing behind) | test/run.test.mjs:487 `killFixtures` | When the runner under test is broken (mutation 1), the hung file's per-file scratch folder `/tmp/dtr-XXXXXX` stays behind. It holds the shim dir and a `dt-tmux-*/tmux-1000/default` socket with no server. `killFixtures` kills the processes and the tmux server but never removes `o.scratch`, even though `pids.json` records it. It is harmless (empty, no live server, no lock) and only happens when the runner is already failing. The same teardown serves the hung, SIGINT and SIGTERM tests, unchanged since pass 3. Fix: in `killFixtures`, `fs.rmSync(o.scratch, …)` when it matches `^/tmp/dtr-` or `^/private/tmp/dtr-`, after the kill-server step. | |

Runs, from the review worktree, each as `sh docs/devteam-dev/tickets/kit-209-test-runner/t.sh <v> test/run.test.mjs`, one at a time: Node 24 at e17235c, 39/39 pass (21.7 s). Node 18 at e17235c, 38 pass, 1 skipped (compile cache, Node 22.1+), 0 fail (24.4 s). Mutation 1 on 18: 37 pass, 1 fail (test 37). Mutation 2 on 24: 36 pass, 3 fail (tests 37 to 39). I started no kit command or dashboard outside the tests. My tap files went to a private `mktemp -d` folder. Other reviewers ran the same fixtures on this box at the same time, so I can't tell which of the leftover `/tmp/dtr-*` folders from my mutation runs are mine (I saw two new ones, each with a dead socket). I left them in place rather than delete someone else's.

No Critical or Important issue found.

Verdict: APPROVE e17235ca9f6b100781869b865b7362a483ee5c44
