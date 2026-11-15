# Spec review, pass 3

- Reviewer: reviewer-c (fresh subagent, claude-opus, cold confirm)
- Reviewed: 05a9473df5ccf90a248fbfa93ee99176fb30ff2e (spec.md, diff since af0e1f0)

Pass-2 checks. F2-1 is resolved: no claim is ever given back, so every relaunch that starts spends an attempt under `claimRestart` exactly as today, and `restart-gave-up` still bounds a session that keeps failing. F2-2 is resolved: with nothing released, the 10-minute `RESTART_EVERY_MS` still keeps a retry clear of an orphaned `worktree_setup`. F2-3 is resolved: the `restartPane`/`releaseRestart` text is gone. Done_when 3 still holds. With no `worktree_setup`, a tick under the ceiling can relaunch 3. With one, 3 is still an upper bound ("up to 3"), and the spec says plainly that a setup over about 10 s means one a tick. Each relaunch that runs goes through `claimRestart`. A session passed over for time gets `budget()` = 0, and `claimRestart(name, 0)` returns `null` (or `gave-up` when already at the cap) before it writes anything (devteam.mjs:12659-12660), so it is not claimed. The first relaunch of a tick keeps today's rule, `RESTART_MIN_MS` with up to 100 s. The way the spec decides that a repo "can't be read" is a plan matter (plan-3 F3-1).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F3-1 | Minor | accuracy | spec.md header ("Depends on `kit-202-lost-enter-retries` (not merged yet: build waits for it)") | The new ruling adds kit-239 and kit-86 to depends_on, and the plan says to wait for all three and the supervisor's word. The header still names only kit-202. Make it match the ruling. | |

Verdict: APPROVE 05a9473df5ccf90a248fbfa93ee99176fb30ff2e
