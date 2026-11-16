# Task 3 review, pass 2 (confirming T3-1)

- Reviewer: task-3/4 confirming subagent

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Checked and found sound (scope: T3-1 only):
- f33b9c2f (test only) adds three off-box route cases to 'POST /api/owner-setting from the page runs owner-setting', each going through `refused`, which asserts the status, the error and that nothing was written:
  - `{ key, value: 7, extra: 1 }` → 400 `missing or invalid fields: { key, value }`;
  - `{ key }` → 400, with the same message;
  - `{"key":"max_active_tickets","value":7}` followed by 600 spaces (exact keys, over 512 bytes) → 400.

  In the box test, the signed-body loop now also posts that whitespace-padded body with a valid owner-setting signature and expects 400.
- Baseline in a scratch worktree at f33b9c2: `--test-name-pattern "api/owner-setting|on a box the save"`, `--test-concurrency=2`, every DEVTEAM_* unset, a fresh HOME, DEVTEAM_HUB_PORT=4517. Result: pass 2, fail 0.
- Mutation 1, removing `|| Object.keys(parsed).sort().join(',') !== 'key,value'` from the /api/owner-setting handler: pass 1, fail 1. The route test fails at the extra-field case (test/owner-setting.test.mjs:294, expected 400, got 200), because off a box nothing else refuses the extra field.
- Mutation 2, raising the owner-setting cap from 512 to 20000: pass 0, fail 2. The route test fails at the padded-body case (:296, expected 400, got 200). The box test fails in the signed-body loop (:363), on the padded body signed by the gateway, because the CLI accepts its exact keys.
- The scratch worktree was removed afterwards. No other file was touched.

Verdict: APPROVE f33b9c2f8166177b5bea85e1d5fec587844af5be
