# Plan review, pass 3

- Reviewer: plan-reviewer 3 (fresh subagent, claude-opus-5-5)
- Reviewed: 91fc88000007d73f0a26feaca571322a1a322e1f (plan.md)

I read `git diff fbd0b77 HEAD -- plan.md` against reviews/plan-2.md (N1, N2), the ruling m-20261115-083529748 and spec.md. I checked the new default-port dashboard case against the code in docs/devteam/scripts/devteam.mjs: `HUB_PORT`, `PORT_BASE` and `PORT_RANGE` (~11724), `pickDashboardPort` (~11751), `imageHub` and `cmdDashboard` (~14238), the dashboard's `accountsTick` (~14589), its `listening` handler (~15099), `cmdAccountsTick` (~13793), `noteSupervisorFromTick` (~12595), `findCswap` (~12031), `machineRepoDir` and `registerOnMachine` (~12759), `cmdRecover` and `recoverMachine` (~12743, ~12842), and every `HUB_PORT` and `os.homedir()` use. I also checked test/lib/kit.mjs, test/lib/ports.mjs and test/machine.test.mjs's `baseEnv`. I only read code. I ran no kit command and no test.

- plan-2 N1: taken. The `finally` now waits for each dashboard to exit before it removes the control's record. See N1 below for the part that is left.
- plan-2 N2: taken. One whole-segment `within(dir, p)` helper, built on `path.relative`, now serves both "under" and "ancestor of". That matches spec scratchRootWhy.
- Ruling: taken into test 2 as the ruling asks. Role supervisor is not `sessionRun()` (spec: TICKET, FEATURE, or role worker or planner), so the dashboard passes no `DEVTEAM_HUB_RECORD=off`. The `accounts-tick` child (`DEVTEAM_ROLE=supervisor`) then reaches `noteSupervisorFromTick` and `registerOnMachine`. With no explicit port and a root under `h2/code`, outside the sibling `TMPDIR`, it writes `h2/.devteam/repos-4320/<sha16>.json`. That is the spec's "supervisor's own ... register as today", and `recover --machine --dry-run` reads it back through `machineRepos`. The case would fail if the new guards over-reached, which is the point of the ruling.

Safety of the default-port case:

- No hub on 4320. With `DEVTEAM_HUB_PORT` removed, `HUB_PORT` is 4320. `DEVTEAM_IMAGE_HUB: '4320'` makes `imageHub() === HUB_PORT`, so the `listening` handler logs "left to the image" and never calls `startHub`. That is the only `listen(HUB_PORT)` (~11993).
- Its own port is in the test's block. `DEVTEAM_PORT_BASE` (PORTS+1, set by kit.mjs) stays in the env, so `PORT_RANGE` is the test's 25 ports. A fresh repo has no `dashboard_port` and no `run/dashboard-port`, so nothing is pinned. Blocks lie in 20000..32699, well clear of 4321..4345. The box's real hub scans its own range and never sees this dashboard.
- No write under the real ~/.devteam. Every machine path is built from `os.homedir()` (`machineRepoDir`, `rotateClaimFile`, `operatorDir`, `statusLastFile`, `hub-<port>.log`, the cswap data dir, `CLAUDE_CONFIG_DIR`'s default), and that follows `HOME=h2`. The dashboard's `accountsTick` and `recoverMachine` copy `process.env`, so the children keep `HOME=h2`.
- No contact with 127.0.0.1:4320. The only clients of it are `previewNamesElsewhere` (preview registration), `hubLine` (`machine status`) and `startHub`'s probe (skipped). The case uses none of them, and `recover --machine --dry-run` (role supervisor is allowed) makes no hub call.
- Accounts. At port 4320, `findCswap`'s fixture guard (`HUB_PORT !== 4320`) no longer applies, so `DEVTEAM_CSWAP=off` is the only thing that keeps the real cswap out. kit.mjs sets it process-wide and test 2 says "cswap off", so it holds. See N2.
- tmux. With `DEVTEAM_MACHINE_EPOCH` from `baseEnv`, `noteSupervisorFromTick` goes on to its pane checks. A fresh repo has no noted pane, and the kit.mjs shim confines tmux to the test's server anyway.

Nothing in the changes contradicts spec.md. Spec Testing says "Nothing touches the real HOME or port 4320". In this case 4320 appears only in a directory name under the fake HOME and as the image-hub setting, so the case stays within that line.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| N1 | Nit | test hygiene: ordering | Task 1, test 2 finally | Waiting for the dashboard to exit does not wait for an `accounts-tick` child it already spawned. `execFile` children outlive a killed parent, so a tick started just before the kill can still rewrite the control's record after the `rmSync`. plan-2 N1 also asked for one tick period of wait. This is harmless (pass 1 found no later assertion that the record breaks). Add a short wait (more than one 200 ms tick), or remove the record and check it again, to close the gap. | applied in Task 1: after the dashboard exits, wait past two ticks before removing the record |
| N2 | Nit | safety: explicit guard | Task 1, test 2, default-port case | At port 4320, `DEVTEAM_CSWAP=off` is the only guard between this dashboard's tick and the machine's real cswap: `findCswap`'s fixture check no longer applies. kit.mjs sets it process-wide, so the case is safe as written. Still, the case's env should list `DEVTEAM_CSWAP: 'off'` itself, with a comment saying why, so a later edit that builds the env from scratch cannot drop it. | applied in Task 1: the case sets DEVTEAM_CSWAP off itself, with the reason in a comment |
| N3 | Nit | clarity | Task 1, test 2, default-port case | "`TMPDIR` the test's sibling scratch dir" names a dir that only test 1 defines. Say that test 2 makes `h2` and its `TMPDIR` dir as two `mkdtemp(tmp, …)` siblings. Without its own `TMPDIR`, the child's `os.tmpdir()` holds `tmp`, `h2/code` counts as under the temp folder, and the case can never pass. That failure is safe, but it would be misleading. | applied in Task 1: test 2 makes its own sibling HOME and TMPDIR |

Verdict: APPROVE 91fc88000007d73f0a26feaca571322a1a322e1f
