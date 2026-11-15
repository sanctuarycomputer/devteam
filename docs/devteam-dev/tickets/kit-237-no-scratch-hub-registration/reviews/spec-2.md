# Spec review, pass 2

- Reviewer: spec-reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: 5c0ae2a69ea67d00a295a9b8127b42b201017686 (spec.md)

I read the diff 29217ef..HEAD of spec.md against spec-1's five findings, the ticket (`ticket show kit-237-no-scratch-hub-registration`) and `docs/devteam/scripts/devteam.mjs` (machineRepoDir, registerOnMachine, machineRepos, machineProjects and its callers at ~12851, ~13037, ~13565, ~13589, ~13716, machineStatus, cmdAccountsTick's refusal at ~13796, the dashboard's accountsTick at ~14589). I also checked test/hub-overview.test.mjs ~580-596, the daily-review asserts in test/machine.test.mjs ~468-479, every `repos-` reference under test/, and test/lib/kit.mjs, which strips every non-harness `DEVTEAM_*` var at load. Reading only. Nothing was run.

- F1: fixed. The stray lines now come after `boxStatusLine()`, so `lines[hub + 1]` in hub-overview stays the box line. The daily-review asserts are `^…$`/m matches with no ordering, so placing the strays before or after that line breaks nothing. With no box line, a stray at hub+1 conflicts with nothing.
- F2: fixed. The Design says the dashboard passes `DEVTEAM_HUB_RECORD=off` whatever the port, and calls this a deliberate narrowing. That matches the session-dashboard test, which runs on the test's own port and expects no record. The narrowing doesn't conflict with the ticket's done-when 1. Its exemption exists so fixtures keep their own hub, and it doesn't require a session env to register. No existing test reads a record that a worker- or planner-env dashboard wrote: the only `repos-` readers are machine.test ~383 and recovery ~815, and both write their records by hand. The harness strips `DEVTEAM_TICKET`, `DEVTEAM_FEATURE` and `DEVTEAM_ROLE`, so a worker running tests doesn't pass its own session env into fixture dashboards.
- F3: fixed. Paths are compared by whole segments, and a TMPDIR that is `/`, home or an ancestor of home is ignored. On this box the agent TMPDIR sits under home, not above it, so real roots under `~/code` stay real. The Edge cases already cover the realPath symmetry for the temp side. See N1 for the home side.
- F4: fixed. Testing names the comment beside the registration tests and the reason for it (accounts-tick refuses a session env at ~13796).
- F5: fixed. Done-when 2's parenthetical now names box-status, `machine tell|questions|knowledge` and `recover --machine`. That matches machineProjects' callers, and the hub list is said to come from port probing.

The fixes introduce no contradictions between Design, Testing, Edge cases and the ticket.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| N1 | Nit | spec wording | Design, scratchRootWhy's home guard; Testing, "Registration, no explicit port" | The new guard (a temp dir that is home or an ancestor of it is no temp dir) should compare `realPath(os.homedir())` with the realPath'd temp dir, as the temp side already does. Otherwise a symlinked home slips past it. The registration test sets a fake HOME and a child TMPDIR "under the test's tmp". If the implementer creates the fake HOME inside that TMPDIR, the guard switches temp detection off and the "under TMPDIR writes nothing" case fails. It fails loudly, not vacuously. Keep the two as siblings. Either point can go in the plan. Neither needs a spec change. | taken into the plan: realPath of homedir; fake HOME and TMPDIR are siblings |

Verdict: APPROVE 5c0ae2a69ea67d00a295a9b8127b42b201017686
