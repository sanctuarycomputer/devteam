# Plan review, pass 2

- Reviewer: plan-confirm (fresh subagent, claude-opus-5-5)
- Reviewed: 2a441a9e0da3f5cf2e130434a41bf5a4835ac9cd (plan.md, diff since fc9eaf7)

- F1 fixed: T0's `/box.json` comment now says "from the image's ENV: its release and its tools' pins" without naming either variable. A new T0 bullet says no comment in gateway.mjs may spell them out. Today gateway.mjs names neither variable anywhere, so T1's count assertion holds.
- F2 fixed: the constant is now `BOX_IMAGE`, used the same way in the implementation, the route and the source assertion (`image: BOX_IMAGE`). The plan notes that the existing `const IMAGE` regex at cloud/gateway.mjs:1347 is left alone (confirmed there, inside `createGateway`).
- F3 fixed: the R2 class is now `/^[\w .,'+?-]+$/`. Every expected text in T3 matches it, including "kit, ?", "hub ?, box v0.52.0", "isn't", "Claude Code 2.1.310" and "hub not answering", and the checks for no `http` and no `<` stay.
- F4 fixed: `amber` and the new `tools` helper spread the vm array and map to `String(x.text)`, so `deepEqual` compares outer-realm arrays. `line` still returns a string. The tools case now asserts `tools(...)` deepEquals `['gh 2']`.
- F5 fixed: T4 now uses `PORTS + 96`, which no other test in hub-overview.test.mjs uses (the file uses +26..+41, +60/61 and +90). It stays inside the 100-port block, and the plan's comment names the ranges it avoids. `hubMachine` already clears `BOX_VARS` (hub-overview.test.mjs:226/242), so the test's added variables are the only ones present.
- F6 fixed: the `serve` test has a third run with only `DEVTEAM_BOX_TOOLS='gh=2.83.0'`, expecting `image: none` and never `image: null`.
- F7 fixed: a file-level `BOX_VARS` and `cleared(extra)` are defined once, near `freePort` (gateway.test.mjs:71), and no such name exists there yet. The signed-in test (~L319) keeps its own `env` and passes `{ env: cleared() }` to `gateway(...)`. Its `extra` parameter (L72) carries that through as before. The other T1 tests call `cleared({...})`.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE 2a441a9e0da3f5cf2e130434a41bf5a4835ac9cd
