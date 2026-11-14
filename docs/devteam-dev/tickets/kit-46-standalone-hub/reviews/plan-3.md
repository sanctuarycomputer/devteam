# Plan review, pass 3

- Reviewer: plan-confirmer-3 (fresh subagent, claude-opus)
- Reviewed: 4ba60a40a92588f97881a13907e33ed2d7a598e2 (plan.md, diff since 013ae42)

- P2-1 fixed: T1 Step 1 now gives all eight hubs a port, each used once in the file: +40; +36, +37, +38; +39 (the dashboard's hub); +30, +31 (holder 1 and holder 2); +32. None of them is +26..29 (T2) or inside the +41..65 scan. The only fixed ports the existing hub-overview tests bind are +60/+61.. and +90, so none of these collides with an earlier test.
- P2-2 fixed: T3 spawns the hub with its own `env` (`M.env` plus `DEVTEAM_HUB_PORT=PORTS+36` and `DEVTEAM_PORT_BASE=PORTS+60`, minus the three box vars), "never `M.env`". Its scan is +60..84, inside the block. The three box vars are `DEVTEAM_IMAGE_HUB`, `DEVTEAM_KIT_RELEASE` and `DEVTEAM_BOX_TOOLS` (plan line 11), so the gateway vars, which make this a box, stay in. The new note on `M.store()` is correct: `machine()` builds `dir` as `home/operator` on a box and never reads a port for it. In this file, `hubFixture` binds only +30 and +31 (one dashboard), so +36 is free. P1-6 is now fully fixed.
- P2-3 fixed: T4 goes back to the `v1.2.3` body before the alert case and closes the server only after it, so `DOWN` is the last case.
- P2-4 fixed: the T2 Interfaces line now names the run (d) value, `0x<hubPort in hex>`, as Step 1 does.
- P2-5 fixed: the cleanup skips both the kill and the wait when the child has already exited. The try/catch is not added. The plan does not need it for the case the finding raised, the 1 MB test's hub that already took SIGTERM.
- The diff adds two more things, and neither is a defect. The 1 MB test checks the size again after SIGTERM, which tightens spec check 3. The new Rulings line records a supervisor message, which this review takes as given.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE 4ba60a40a92588f97881a13907e33ed2d7a598e2
