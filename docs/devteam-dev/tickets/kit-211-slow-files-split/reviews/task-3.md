# Task review: T3 recovery

- Reviewer: task-reviewer 3 (fresh subagent, claude-opus-5-5)
- Reviewed: 2f1b48f4ef8bd811747054c81eca08e8b611109e (test/recovery.{relaunch,restart,recover}.test.mjs and test/lib/recovery-fixture.mjs)

## What I read and ran

- Read: spec.md (split shape, fixed waits, ruling m-20261115-161102170), plan.md T3 and the fixed-wait list, edits.mjs `recovery` entries and its apply loop, lint.mjs, the four files at 2f1b48f, base `test/recovery.test.mjs` at e8022ac, `test/lib/kit.mjs` (`until`, per-process `TMUX_TMPDIR` and `DEVTEAM_HUB_PORT`), and the kit's `tmuxSessionAge` / `sessionsToRelaunch` (devteam.mjs ~L12296-12318), `SHELLS` (L15207) and `resolvePane` (L15225-15245, the "has a live agent" refusal at L15850).
- Reproduce: `git archive 2f1b48f` into a private `mktemp -d`, base recovery.test.mjs put back, the three parts and the fixture deleted, `split.mjs recovery` (8 + 11 + 16 tests, fixture 0 tests) then `edits.mjs recovery` (3 edits). `cmp` against 2f1b48f: all four files byte-identical. Temp folder removed; no worktree added.
- Verbatim check (node script): all 35 `test(...)` blocks in the parts occur verbatim in the base except the two edited ones (the key guard, the race). The only base lines absent from the head are the header comment (reworded in the fixture), the kit.mjs import line (recomputed per file), and the three sleeps replaced by edits (`sleepMs(1100)` x2, `sleepMs(200)`). No assertion dropped.
- Edits vs the kit:
  - Key guard 1: polls until `floor(Date.now()/1000) > session_created` (read with `display-message` on the same `TMUX_TMPDIR` server, guarded by `assert.ok(made > 0)`), then takes `now`. The kit relaunches only if `session_created*1000 > Date.parse(at)`; with `at >= (made+1)*1000` that is false, so the windows stay closed, as the base's 1.1 s intended.
  - Key guard 2: polls until `floor(Date.now()/1000) > floor(Date.parse(now)/1000)`, then `ensureSession()`. The new session's floored `session_created` is then at least `floor(at/1000)+1`, so `created*1000 > at` exactly as the kit compares. Same system clock for node and tmux.
  - Race: polls until `pane_current_command` matches `/^-?(sh|bash|dash|zsh)$/`, a subset of the kit's `SHELLS`, compared the same way (`cmd.replace(/^-/, '')`) as `resolvePane`, which is what the `--resume` live-agent refusal reads. The stub's own name (`stubshell`) does not match, per spec review N1. `until` is 100 ms / 120 s cap.
  - Each edit carries a comment saying why it waits. All three are named in spec and plan; nothing else is edited.
- `names.mjs e8022ac 2f1b48f recovery`: 35 tests before, 35 after (recover 16, relaunch 8, restart 11), `diff: none`.
- `lint.mjs` over the four files: exit 0, no problems. Base file: exit 0 too, so no unused names to carry.
- Standalone: each part imports only the fixture and lib/kit.mjs. The fixture's module-level effects (HOME and SHELL_DIR mkdtemp with exit cleanup, the stand-in claude and stub shell, the `keep` tmux session and `default-shell`) run once per importing process, on that process's own `dt-tmux-` server and port block, so no part depends on another having run. Fixture exports, by use: CLAUDE_RESUME, SID, SKIP, SUP, rateLimit, supervisorPane, tmuxShim (restart + recover); findings, fixture, OFF (all three); sleepMs, STUB_SHELL (relaunch + recover); HOME (recover + fixture); MENU, ROOM (restart + fixture's own `supervisorPane` default and `fixture()`). TMUX_BIN and AS_SUPERVISOR are fixture-internal. Single-part code stays in its part (FULL, withCswap, left in restart; asOwner, recover, upFile, upRecord, seenUp, privateServer, sessionTranscript in recover). No test bodies in the fixture. `recover --machine` reads the per-process HOME registry with `match`es, not counts, so it doesn't lean on earlier tests' repos.
- Results: local-run-1.log (at 662bbfd; `git diff 662bbfd 2f1b48f` touches only edits.mjs and operator-threads.hub, not these files): recover 16/16 ok in 24.4 s, relaunch 8/8 ok in 16.7 s, restart 10 ok + 1 skip in 27.3 s. The skip ("a process that can't be read") is `process.platform === 'linux'`, the same at the base. I did not run a part myself; the log at identical files was enough.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE 2f1b48f4ef8bd811747054c81eca08e8b611109e
