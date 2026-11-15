# Plan review, pass 2

- Reviewer: plan-confirmer (fresh subagent, claude-opus)
- Reviewed: 013ae420766462b1a494f2a738400315d2dc44ab (plan.md, diff since 36f1b24)

- P1-1 fixed: T4 runs `machine status` with a promisified async `execFile`, and the fixture server stays in the test's own event loop.
- P1-2 fixed: the new helper is `ownKitVersion()`. That name does not occur in devteam.mjs, so it cannot clash.
- P1-3 fixed: the log is pre-filled to 1048570 bytes, so the first line must rotate, and `.1` is asserted with those bytes. The plan does not check the size again after the SIGTERM line. Spec check 3 does not ask for that, so this is not blocking.
- P1-4 fixed in substance: each hub has its own port and the test waits on that port, so no earlier hub can answer for a later one. The extra log-line assertions are not added. Spec check 1 does not require them.
- P1-5 fixed: Step 1 run (d) uses `0x<hubPort hex>`. That value is equal to the hub's own port but is not a plain port, so the test fails if the regex is missing. The Interfaces line is stale (P2-4).
- P1-6 partly fixed: `PORTS+36` is inside the block and outside the hub's own scan (+60..+84). The step still spawns the hub with `M.env` (P2-2).
- P1-7 fixed: the count starts at the first `isn't a devteam hub` line, then waits 2 s (at least 8 retries at 200 ms). A logger that writes on every retry fails the test.
- P1-8 fixed: each run has a fresh bareProject, its own hub port (+26..+29) and a stopped dashboard. The extra `hub on` assertion is not added. It is not needed, because the port is fresh.
- P1-9 fixed: both crash strings are kept exactly. They match devteam.mjs line 13764.
- P1-10 fixed: the 10 KB `kit`, the over-64 KB body and `kit: null` cases are added, the alert is cleared in `finally`, and the three box vars are deleted from a copy of `baseEnv`. The case order is a new issue (P2-3).
- P1-11 fixed: the test waits until the list answers `kit: 'v9.9.9'` before it starts the dashboard.
- P1-12 fixed: the helper sends SIGKILL to the process group and awaits `exit`. The guard is a new issue (P2-5).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Important | test/lib/ports.mjs ("a port one test binds should be one no test before it in that file can still be holding"); T1 Step 1's own rule "never reused within the file"; done-when 3 | T1 Step 1, port list | The plan names five ports (`+40, +36, +37, +38, +39`, "in the order below"), but the tests below start seven standalone hubs: test 1 starts one, test 2 starts three (no release, `''`, `nope`), the retry test starts two (holder 1, then holder 2 "on a new port"), and the 1 MB test starts one. Holder 2's hub and the 1 MB test's hub have no port, so the rule P1-4 relies on cannot be followed as written. The helper env no longer sets `DEVTEAM_HUB_PORT`, so the dashboard-hub test's port is unstated too. Name every port. Free in-block candidates below the +41..+65 scan, clear of T2's +26..+29, are +30..+35. | fixed |
| P2-2 | Important | P1-6; test/lib/ports.mjs (a bound port must be in the file's block); a step that contradicts itself | T3 Step 1 | The step first defines `env = { ...M.env, DEVTEAM_HUB_PORT: String(PORTS+36) }` "used for the hub", then says to spawn the hub "with cwd `nowhere` and `M.env` minus the three box vars". `M.env` carries `M.hub` = `PORTS+80+n`. That is the 21st `machine()` here, so +101, the neighbouring block, which is what P1-6 was about. Say the hub spawns with `env` (minus the box vars, plus `DEVTEAM_PORT_BASE=PORTS+60`), and that `own`'s origin and every fetch use `PORTS+36`. Also, `M.store()` is a closure over the box's `home/operator` and reads no env, so drop "and for `M.store()`'s reads". | fixed |
| P2-3 | Minor | a step that is ambiguous; done-when 5 | T4 Step 1, case order | The cases run "server closed → `DOWN`; `machine alert -- look` then → `up, kit v1.2.3; alert: look`". Once the server is closed, the alert case cannot answer `up`. Either run the alert case before the close, or reopen the server with the `{hub:1,kit:'v1.2.3',instances:[]}` body. | fixed |
| P2-4 | Minor | P1-5; a stale interface | T2 Interfaces | The Interfaces still say "the T2 test adds `0x10E0`-style value as a fourth run". Read literally (`0x10E0` = 4320), that is the case P1-5 showed cannot fail. Change it to match Step 1(d): `0x${hubPort.toString(16)}`. | fixed |
| P2-5 | Suggestion | test hygiene (P1-12) | T1 helper `startHubCmd` | The 1 MB test SIGTERMs its hub, so by `t.after` the child has already exited. `process.kill(-pid, 'SIGKILL')` then throws ESRCH, and awaiting a later `exit` event never resolves, which hangs the test. Skip the kill and the wait when `exitCode !== null \|\| signalCode !== null`, and wrap the kill in try/catch. | fixed |

Verdict: CHANGES 013ae420766462b1a494f2a738400315d2dc44ab
