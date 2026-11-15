# Spec review, pass 2

- Reviewer: spec-confirm (fresh subagent, claude-opus-5-5)
- Reviewed: 470270240396ee7622432cfccc6431611eff2998 (spec.md, diff since a28ebcc)

This pass is a cold confirm of the diff only. I checked the code it relies on at 4702702: `hub.html` `draw` (~1281, `catch { return; }`), `findBox` (~1386, `box` built from three named fields), `.ov-head` (~64, a flex row that wraps) and `.ov-head .acts` (~107, `margin-left: auto`), the `--fg-2` and `--amber-fg` tokens (~17/~25), and the children of `paintOverview`'s head (h1, `.sum`, optional `.acts`). In `gateway.mjs` I checked `uploadsRoot` (~897, `DEVTEAM_UPLOADS_DIR` else `/data/uploads`) and `serve` (~2425, which sweeps before listening). In `test/hub-overview.test.mjs` I checked `hubMachine` (~234: temp HOME, `BOX_VARS` deleted) and `BOX_VARS` (~226).

- F1 (Important): fixed. Acceptance 4 now runs under `hubMachine`'s env, with a temp HOME, a fixture `DEVTEAM_HUB_PORT` that nothing holds, and the box variables cleared. `machineProjects` and `statusLastFile` therefore stay out of the real `~/.devteam`.
- F2 (Important): fixed. Acceptance 3 adds source assertions on bodies cut from `hub.html`: `findBox` keeps `image` on `box`, and `draw` assigns `hubSeen` both from what it read and to `null` in its failure path, which then calls `paintOverview()`. The `paintOverview` → `boxLine(` assertion stays.
- F3 (Important): fixed. On any failed fetch or parse, `draw` now sets `hubSeen = null` and paints. `boxLine` gains a `list.hub !== 1` branch that shows "hub port held by something that isn't a hub" in amber, and the test covers it. A non-hub's HTML therefore shows "hub not answering", and its JSON without `hub: 1` no longer claims "a project's kit".
- F4 (Minor): fixed. The token rule (`?`) on `kit` now applies in every branch, and so does the comparison. A test case covers a bad `kit` (an escape, 10 KB) with `image: true`.
- F5 (Minor): fixed. The `serve` child gets a temp `HOME` and `DEVTEAM_UPLOADS_DIR`, and the box variables are cleared. The test reads the line independently of the listen line, then kills and waits for the child in a `finally`.
- F6 (Minor): fixed. The spec now says spaces only count as unset, and that `opts.env` is read only by `boxImage`, with every other `env.*` read staying on `process.env`.
- F7 (Minor): fixed. The CSS is given: `.ov-box` gets `flex-basis: 100%; order: 1`. That gives it its own row after h1, `.sum` and `.acts`, which matches "under the headline, summary and buttons". Both tokens exist. The div goes in the DOM after the summary and before `.acts`.
- F8 (Suggestion): fixed. Acceptance 4 adds a run with an escape in the release (it prints `?`) and an escape in one pair (that pair is skipped).
- F9 (Suggestion): fixed. The source assertion is now an equal-count check against `G.boxImage.toString()`.

The diff adds no new Critical or Important defect. One edge is untouched and comes from today's code: a hub-port answer of the JSON literal `null` makes today's `data.instances` throw after the parse, and the spec doesn't say whether `hubSeen` is set before that throw. It needs something on 4320 to answer `null`, so I'm not raising it as a finding.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE 470270240396ee7622432cfccc6431611eff2998
