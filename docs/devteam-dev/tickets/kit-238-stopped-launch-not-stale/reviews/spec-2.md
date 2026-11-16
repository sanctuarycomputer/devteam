# Spec review, pass 2

- Reviewer: spec-plan-reviewer-2 (subagent of kit-238-stopped-launch-not-stale)
- Reviewed: 9536720b16f3d6f58853cdc91595461cf05e1a2b (spec.md against the ticket's done_when, spec-1's findings and devteam.mjs at that head; `git diff c8c839b 9536720`)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Spec-1's findings, checked in the text, not only in their dispositions:

- F1 (relaunch is a new start): fixed. "Behaviour changes" now makes `started` and `ran` `lastPhaseOf(id) && !stoppedLaunch(id)` and runs the coverage-gap guard for a stopped launch. Acceptance check 2 shows the draining-goal refusal, then the relaunch. In the code, `refused = … (mode === 'drain' && !started)` (devteam.mjs:15930) and `memFull = flags.resume && ran ? null : memNow` (:15938) both follow from that one change.
- F2 (held and stopped, which wins): fixed. The `status` precedence is prompt, then `HELD: <reason>`, then `not started`, then STALE. Check 4 is kit-211's shape, and `not_started: true` stays in its JSON row.
- F3 (moved fleet, linked repo): fixed. Both are under Edge cases. They agree with makeSession, which makes the worktree at `<home>/.worktrees/<id>` (:15950) and continues from `origin/ticket/<id>` (:15957-15960).
- F4 (`liveSessions` residual): fixed. Out of scope names drain, `fleet move` and the fleet-drain check as the known residual.

Done-when coverage. Done-when 1 maps to checks 1 and 4: stale-worker, STALE versus `HELD:`, `active`, `active_per_component`, `active workers`. Done-when 2 maps to check 2: `not started`, stale-worker, the caps, and the relaunch as a new start. Done-when 3 maps to check 3. I looked for any other place a held ticket or a stopped launch counts as a worker. `grep activeWorker` gives :2931 `paneWaiting` (a held pane's prompt still shows, as Edge cases says), :3695 `liveSessions` (out of scope, named), :3800/:3816 `cmdReady`, and :11478/:11524 in metrics. `max_active_per_component` is read only in `cmdReady` (:3819, :3825). No other cap count is missing.

The definition holds up. A live launch has its worktree before its window and its `starting` line (:15948-15962, :16044). `worker --remove` leaves the window open ("now close its window"), so a removed worktree alone never makes a session read as stopped. CI's kit job installs tmux (.github/workflows/test.yml:48), so the window-dependent checks run in CI.

Values and refusals (cold confirm of pass 1): nothing new. The change reads the log, the worktree directory and tmux, as the existing code does. No authority, rung or owner line changes. The new status words are plain.

Verdict: APPROVE 9536720b16f3d6f58853cdc91595461cf05e1a2b
