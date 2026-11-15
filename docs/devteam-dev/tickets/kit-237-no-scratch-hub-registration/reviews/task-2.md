# Task 2 review, pass 1

- Reviewer: task-reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: 51d61472637f94701be0012bd630304172c48ec6 (docs/devteam/scripts/devteam.mjs, Task 2)

Read: the ticket (done_whens), spec.md, plan.md Task 2 and its rulings, `git show HEAD -- docs/devteam/scripts/devteam.mjs`, the surrounding code (realPath at 406, realPathMade at 483, HUB_PORT at 11724, writeSupervisorUp, noteSupervisorFromTick, machineProjects and its callers at 13069/13597/13621/13748, machineStatus, cmdDashboard's accountsTick, worker/planner launch at 15852), the new tests in test/machine.test.mjs (395-505), test/recovery.test.mjs 805-840, test/hub-overview.test.mjs box-line test, cloud/Dockerfile's dashboard and hub launches, governance/code-style.md (head).

Ran: `node --test --test-concurrency=2 --test-name-pattern='recorded|hub record|registers with|dashboard doesn|stray' test/machine.test.mjs`: 5 pass, 0 fail (includes "tell and status find a project the machine recorded" and the three new tests). Afterwards `ls ~/.devteam/repos-4320/` lists exactly 37843d29b620c303.json 525596261976375a.json a26b983ab68cac7a.json b3ed4fa05c718174.json d6ea08ca2e1e63a4.json. Probed `within` in node: equal paths true, trailing slash true, `/tmp` vs `/tmpx` false, `/tmp/..x` true, child-of-p false, `/` vs `/data` true, `/data/ho` vs `/data/home` false.

What holds:
- `within`: `''` is equal; `..` and `../` prefixes rejected, a segment merely starting with `..` accepted; an absolute `rel` (different roots, Windows) rejected. Correct by whole segments.
- `tempDirs`: deduplicates after realPath, resolves a relative TMPDIR, drops `/`, home and any ancestor of home via the same `within`. On the box (HOME=/data/home, TMPDIR=/data/home/tmp per cloud/Dockerfile 336) projects under ~/code are not under the temp folder; the box's scratchpads (under /data/home/tmp) are.
- macOS `/var` vs `/private/var`: both sides go through realPath; registerOnMachine has always written realPath'd roots, so existing records hold the resolved form.
- TDZ: the new consts sit at ~12760, are only called from function bodies (registerOnMachine, machineRecords, machineStatus, accountsTick), and the command dispatch is at the end of the file (COMMANDS at 19610). No module-evaluation use.
- registerOnMachine's guard matches the spec exactly (off knob wins, else the explicit port exempts session and scratch). Its callers (writeSupervisorUp, noteSupervisorFromTick) are unchanged in behaviour for a supervisor in a real project.
- machineRecords/machineRepos: same filter as before for malformed records (non-string or relative root ignored, not a stray); sorted files; roots deduped and sorted as before. Under an explicit port no stray is computed, so recovery.test 805-840 and machine.test's recorded-project test (both explicit port, temp roots) still find their records; the run confirms the latter. machineProjects (tell, questions, knowledge, status, recover --machine) consumes only `.roots`.
- machineStatus: stray lines come after the box line, so hub-overview's "box line right after the hub line" holds (and that test runs under an explicit port, so there are no strays). Only the file name is printed, filtered by `/^[\w.-]{1,80}$/`, else `?`; the root is never printed. Read-only: nothing deleted.
- Dashboard hand-off: evaluated on the dashboard's own env before the child env is built. The supervisor's dashboard does not carry a session env: the box boot starts dashboards from the entrypoint shell (no DEVTEAM_ROLE/TICKET/FEATURE; the operator's role is exported only inside its own window's shell), the kit's restart hint uses `tmux new-window`, which takes the tmux server's environment, and workers/planners get their DEVTEAM_* by an `export` inside their own window's shell (15852), not by `tmux set-environment`. So a supervisor dashboard is not wrongly silenced; the new test pins the supervisor case at the default port with recover --machine finding it.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| M1 | Minor | spec Edge cases (symlinked temp dir) | devteam.mjs scratchRootWhy | `realPath(root)` returns the path unchanged when the root no longer exists, so a hand-written or pre-realPath record naming a deleted `/var/folders/...` root on macOS is not seen as under `/private/var/...` and is kept as a real root. Kit-written records are already resolved, so this is only the hand-written case; `realPathMade` (483) would resolve the nearest existing ancestor and close it. | fixed: scratchRootWhy resolves with realPathMade |
| N1 | Nit | plan Task 2 | devteam.mjs sessionRun, hubRecordOff | The plan names `sessionRun(env = process.env)` and `hubRecordOff(env)`; both read `process.env` with no parameter. Harmless, since every caller evaluates its own process env, but the plan and code differ. | no change: no caller needs an env parameter; the plan wording was loose |
| N2 | Nit | readability | devteam.mjs within | `!!rel &&` is redundant after `rel === ''` has been handled. | fixed: dropped |

Verdict: APPROVE 51d61472637f94701be0012bd630304172c48ec6
