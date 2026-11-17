# Task review: T1 (upload rules), pass 1

- Reviewer: task-reviewer-t1 (fresh subagent, claude-sonnet)
- Reviewed: e843902fbba96e13541059d11c11d8391b6af439 (ec29814..e843902)

Spec compliance: ✅ the block is a line-for-line copy of the gateway's constants and five function bodies (checked against cloud/gateway.mjs; only UPLOAD_SWEEP_MS and the request timers are left out, as intended), uses no import, and the test compares constants and every function's output on the planned inputs.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Suggestion | | test/attachments.test.mjs:41-47 | The planned inputs leave some drift undetected: isDropImage is never given a .gif, .jpg or a near-miss (a.pngx), and shellQuote's character class is only hit by a plain path and one apostrophe (no space, `$`, `@`). Adding a few such inputs would cheaply tighten the "held equal" check. | fixed in T2: more isDropImage and shellQuote inputs in the shared list |
| T1-2 | Suggestion | | docs/devteam/scripts/devteam.mjs:14597 | The copied comment says "TERM_DROP has their source", but devteam.mjs has no TERM_DROP; it is only true in the gateway. Harmless. | wont-fix the block stays a verbatim copy of the gateway's, comments included |

Verdict: APPROVE e843902fbba96e13541059d11c11d8391b6af439
