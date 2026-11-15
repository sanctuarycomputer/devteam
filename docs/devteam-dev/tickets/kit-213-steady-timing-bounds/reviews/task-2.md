# Task review, task 2, pass 1

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus-5-5)
- Reviewed: 766e71ed00cd58ead1ea44ced398eacc5afc5d2c (test/speed.test.mjs: B5 by live send-keys pids; cleanup stops before removals)

What I checked, against spec B5, done-when 5, the edge cases (F1-6) and plan Task 2:

- B5 rests on the kit. `tmux()` and `tmuxAsk` run tmux with `execFileSync` or `spawnSync` and `timeout: TMUX_TIMEOUT_MS` (30 s), which kill the fake's `sh` and reap it before they return, so in a kit that waited for the typing the pid is gone (not a zombie) before `replyNow`. The answer action (`runAction` for `/api/answer`) has no timeout of its own that could SIGKILL the child first and leave its `send-keys` orphaned and alive. In a passing kit, `send-keys` starts only after `replyNow` (`deliverNudges`) and blocks until `release`, which is written only in the after hook. A `send-keys` whose pid is not yet written at the reply leaves the check trivially true, as the spec allows. Mutation (scratch copy, the `REPLY_FD` queue line removed from `nudgeSupervisor`): the test fails on `replied with send-keys 1228609 already ended, of 1228609` after 30.8 s (exit 1).
- Cleanup order and errors. `cleanup` runs every step, keeps the first error and throws it at the end. The dashboard test registers one hook (write release, `dash?.stop()`, remove the folder) right after `mkdtempSync`, so a failure before `startDashboard` is safe. `stop()` kills the watcher and SIGKILLs the dashboard's group, which holds the answer child and the fake's `sh`. Mutation (the first step logs the pids and throws): the test exits 1 with `first step threw`. Afterwards the dashboard pid is gone, no process has its pid as its pgid, no watcher names it, and the base folder is removed (my check script exited 0).
- Spawns test. `made.push(F)` comes right after `fleetFixture(...)`, both fixtures are made inside `try`, and `finally` cleans each one up with `done()` (tmux kill-server, then the folders). A fixture made before a later setup throws no longer leaks.
- No `Date.now`, `t0` or other absolute ms bound remains. The removed `fs.mkdirSync(base)` was needed only because the old removal ran first.
- Unmodified run: `run-file.sh test/speed.test.mjs` exited 0 (8 pass). `~/.devteam/repos-4320/` holds no trace of these runs.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-1 | Minor | spec done-when 5 ("the first error is thrown at the end so the failure still shows") | test/speed.test.mjs:252-255 | If an assertion in the spawns test's `try` fails and a fixture's `done()` also throws (its `rmSync` can, after `maxRetries`), the `throw` from `finally` replaces the assertion's error. The test still fails, but it reports the cleanup error, not the bound that broke. The old `finally` had the same masking. Catching the body's error and rethrowing it ahead of the cleanup's would keep it. | |
| T2-2 | Suggestion | none | test/speed.test.mjs:15 | `alive` treats a zombie as alive (`kill(pid, 0)` succeeds on one). This is safe today, because every path that runs `send-keys` reaps it synchronously. A kit that ran tmux asynchronously without reaping could slip past B5. Checking the `/proc/<pid>/stat` state for `Z` would close that gap. | |
| T2-3 | Suggestion | none | test/speed.test.mjs:197 | The message's `held.filter((p) => !alive(p))` probes every pid a second time even when the assertion passes, and it can come out empty if a pid's state changes between the two probes. Computing the dead pids once and asserting on that would avoid both. | |

Verdict: APPROVE 766e71ed00cd58ead1ea44ced398eacc5afc5d2c
