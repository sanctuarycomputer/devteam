# Final review, pass 1

- Reviewer: final-reviewer (fresh subagent of kit-238-stopped-launch-not-stale, authorized by m-20261115-180705622-supervisor)
- Reviewed: d49e1463875b4f180b0ec02e72ea4700c281ae20 (the whole branch: `git diff origin/main...HEAD` touches docs/devteam/scripts/devteam.mjs, test/kit.test.mjs and this ticket's own record folder, nothing else; the b9c4961 merge of origin/main touches neither code file)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec Out of scope (dashboard rendering) | docs/devteam/dashboard/index.html:4641 | The dashboard's own "workers active" stat still counts every row whose phase is not done or parked, so a held ticket or a stopped launch still shows there as a worker. The file is outside touches and the spec puts the dashboard out of scope, so this does not block; a follow-up can count rows with `held` or `not_started` out, as `ready` now does. | wont-fix dashboard/index.html is outside the ticket touches; recorded as a follow-up observation (kit238:dashboard-workers-active). |
| F2 | Suggestion | none | docs/devteam/scripts/devteam.mjs:3866 | `HELD: <reason>` is placed ahead of `WAITING ON SUPERVISOR`, so a held ticket in awaiting-word or blocked, silent past stale_after_minutes, now reads HELD on its status line rather than WAITING ON SUPERVISOR. This fits the spec's "HELD for a held ticket with a phase", and the metrics sweep still raises waiting-on-supervisor for it, so nothing is lost from the sweep. Only the status line changes. | wont-fix the spec puts HELD before WAITING ON SUPERVISOR, and the waiting-on-supervisor finding still reports it. |

Checked:

- stoppedLaunch (devteam.mjs:2786). It checks the cheap conditions first: the last phase is `starting`, then that `<mainRoot>/.worktrees/<id>` is missing. Only then does it ask tmux. resolvePane returns `no tmux session` when list-panes returns null (tmux not installed, no server, or no session) and `no tmux window` when the window is missing. Both match the regex. A dead pane or a shell prompt in a present window does not match, so such a ticket counts as a live worker, which is the conservative reading. A launch in progress is never stopped. makeSession makes the worktree before the window and writes `starting` last (devteam.mjs ~16030 to 16070), and a relaunch makes the worktree first. Linked repo: makeSession puts every worker's worktree at `path.join(mainRoot, '.worktrees', name)`, which is the same path stoppedLaunch checks. Moved fleet: no worktree or window on the new machine, so the ticket reads as stopped, and makeSession still continues from `origin/ticket/<id>`, as the spec intends.
- Call sites. cmdReady skips a ticket only when countsAsWorker holds, so a held one reaches the held list and a stopped launch that isn't held goes back on the ready list. `active` and `active_per_component` both use countsAsWorker. In collectMetrics, stale-worker skips `isHeld(ts.get(id))` (the loop runs over ts.keys(), so the lookup never returns undefined) and stoppedLaunch. The metrics ready list is `!(activeWorker && !stoppedLaunch)`, and the metrics active count uses countsAsWorker. agent-exited is unchanged and still needs a window. In makeSession, `ranBefore` feeds the coverage-gap guard, `started` (the drain refusal) and `ran` (the memory ceiling with --resume), all as the spec says. With --resume on a stopped launch the worktree is made fresh, so resume falls back to a fresh start and writes a new `starting` line.
- deriveStatus adds `not_started` only when the phase is `starting` and the launch is stopped. No other row gets a new key. G1 (test/lib/kit.mjs g1Outputs) writes no phase lines, so its rows and goldens are unchanged and stoppedLaunch never calls tmux there. In cmdStatus, held is null for a done or merged ticket, so such a ticket shows its phase as before, and merged tickets are skipped in ready and metrics as before. A held ticket that is parked now shows HELD. The precedence is prompt, HELD, not started, STALE.
- Remaining activeWorker callers (paneWaiting, liveSessions) are unchanged. liveSessions is the residual the spec names.
- Test: CI run 43744899079 (test) at this head has conclusion success, all eight kit jobs success. box-image run 43744899068 is also success. Locally, with the isolated runner and pattern 'stopped launch' at --test-concurrency=2, I judged each run by its exit code:
  - at head with tmux 3.3a: exit 0 (1 pass, 4 skipped by pattern);
  - at head with tmux removed from PATH (hasTmux false, so the no-session block runs alone): exit 0;
  - mutation, devteam.mjs reverted to b9c4961: exit 1;
  - mutation, ranBefore without `!stoppedLaunch`: exit 1 ("worker w-02-stopped should fail");
  - mutation, stale-worker without `!isHeld`: exit 1 ("only the real stuck worker is stale").
  devteam.mjs was restored with git checkout after each mutation, and `git status --short` was clean afterwards.
- The done-whens against the test:
  - Held: covered with a window (w-01-held: no stale-worker, HELD and no STALE, under held, not in active, web count 1, `active workers: 2/`) and without one (w-04-held-stopped).
  - Stopped launch: w-02-stopped is `not started` with `not_started: true` in both phases, raises no stale-worker, is out of active, and is on the ready list again. Under a draining goal it is refused. With the goal running it starts: `made worker`, a second `starting` line, and its worktree. Afterwards it no longer reads `not started`.
  - Real stuck worker: w-03-stuck, with its window, is the only stale-worker, at severity high, shows `[build, Nm STALE]`, and counts in active and in web's count.
  - w-05-worktree proves that a worktree alone makes a launch live.
- Determinism and cleanup: fixed ids, and every phase line is 2 hours old against a 30-minute threshold. The memory-full guard is never taken under the harness. The `finally` kills the fixture's private tmux server and F.done removes the base directory, the early return without tmux included.
- Process: per the supervisor's brief, I read and ran the head in the ticket worktree at d49e146 (clean) rather than in a review-worktree.

Verdict: APPROVE d49e1463875b4f180b0ec02e72ea4700c281ae20
