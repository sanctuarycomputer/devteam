# Task review, T2 (the code), pass 1

- Reviewer: task-reviewer (subagent of kit-238-stopped-launch-not-stale)
- Reviewed: 80907a98bd7bc9f2584eb9600c41798ff20c6e47 (T2 is db7be54, docs/devteam/scripts/devteam.mjs, read against spec.md Terms, Behaviour changes and Edge cases and plan.md T2)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Suggestion | none (taste) | docs/devteam/scripts/devteam.mjs:3864 | A held ticket in awaiting-word or blocked, silent past stale_after_minutes, now shows HELD in place of WAITING ON SUPERVISOR. This matches the spec's precedence and plan T2.3, and the unanswered-message finding still raises it, so it is only a note. | |

Checked:

- stoppedLaunch (:2786) checks the cheap things first: the last phase is starting, then no worktree at mainRoot/.worktrees/<id> (the same path makeSession uses as wt, so a linked repo's ticket is covered too), then tmux last. G1's tickets, which have no starting phase, return before any fs or tmux call. resolvePane returns `no tmux session` when paneTable is null (no session, or no tmux) and `no tmux window` when the window is missing. An exited pane or a shell prompt doesn't match, so those stay with agent-exited and stale-worker as the spec says.
- countsAsWorker is activeWorker and not isHeld and not stoppedLaunch. It is used for cmdReady's skip and active (ids via `.map((t) => t.id)`, which the perComponent loop and `ready --json` expect) and for observe-metrics' active count. Both loops iterate `ts.values()` of a tickets() Map.
- cmdReady: a held ticket reaches the isHeld branch and goes on the held list, with a live window or without one. An unheld stopped launch reaches rows. A held ticket that is also not schedulable goes to waiting. Before, it was skipped, so nothing regresses.
- observe-metrics: `ts` is `tickets()` (:11227), so `ts.get(id)` is right. The stale-worker skip is the last term of the condition, so isHeld and stoppedLaunch run only for a ticket that would otherwise be stale. The metrics ready list uses `!(activeWorker && !stoppedLaunch)` and already leaves held tickets out, as the spec says.
- deriveStatus adds not_started only on a stopped launch's row (a spread of `{}` elsewhere), so other rows, the dashboard's input and the G1 goldens keep their shape. workerState's phase and lastPhaseOf order the same lines by time, so the `w?.phase === 'starting'` guard agrees with stoppedLaunch's own check.
- cmdStatus precedence matches the spec. A waiting prompt comes first (a stopped launch has no pane, so its waiting is null). Then HELD, only for an unfinished ticket (phase not done, no merge sha) and only on a row with a phase, never STALE. Then `[not started: no window or worktree]` when not_started holds and the ticket is not held. Then STALE and WAITING ON SUPERVISOR as before.
- makeSession: ranBefore is `!!lastPhaseOf(id) && !stoppedLaunch(id)`. It drives the coverage-gap guard (`!ranBefore`), started, and so ran. A stopped launch is therefore refused under drain without --force, refused by a coverage gap, and kept under the memory ceiling even with --resume. With --resume, madeWorktree turns resume off, so a fresh starting line is written. A session that ran (a phase other than starting, or a worktree or window present) behaves as before. The author's memory-ceiling and multirepo runs cover that path.
- Other activeWorker callers are unchanged: paneWaiting (:2944), and liveSessions (:3710), whose residual the spec scopes out and verification.md lists.
- Nothing outside touches: T2 changes only docs/devteam/scripts/devteam.mjs. The comments say why, not what.
- The T1 test passes at this head through the isolated runner (exit 0, pass 1 with tmux present).

Verdict: APPROVE 80907a98bd7bc9f2584eb9600c41798ff20c6e47
