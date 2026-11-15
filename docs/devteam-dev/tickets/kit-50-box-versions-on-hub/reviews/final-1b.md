# Final review, pass 1, track b

- Reviewer: final-b (fresh subagent of the supervisor, claude-sonnet)
- Reviewed: a502a79ade15e4401cb1df1d0b0b764536081df6

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec §3 wiring | docs/devteam/dashboard/hub.html (paintOverview / hubSeen) | On a box, before the first `instances.json` read `hubSeen` is null, so a repaint in that window would show amber "hub not answering". The spec defines null this way, so it is as specified; noted only. | deferred (Minor, per the supervisor m-20261115-042638127) |

## What I checked

- Read spec.md, verification.md, quality.md §3, the full non-ticket diff, the gateway test diff and the PR body.
- Gateway: `boxImage` matches the spec (trim, token regexes, first-name-wins, null with both unset, `__proto__` safe via fromEntries). `createGateway` computes it once from `opts.env ?? env`; `/box.json` adds only `image`, `box` stays 1; `serve` writes `image: <release>|none` before the listen line; the variable names appear only inside `boxImage` (a test asserts it).
- Fallback hub list is `{"hub":1,"instances":[],"down":true}`; the hub-list comment gains `down`. The PR body says why the two existing assertions changed. Contract comments came first (commit ba2194d).
- hub.html: `boxLine` branch order and wording match the spec (amber for not answering, not a hub, a project's kit, release mismatch). Parts go in as text spans, with no markup or links. `findBox` keeps `image`; `draw` sets `hubSeen` and on failure nulls it and repaints; the CSS matches the spec. A laptop has `box` null, so nothing shows.
- `machine status` prints `machine: box <release>: <name> <version>, …` after the hub line, with the same token rule, `machine: box <release>` with no usable pair, and nothing with both unset.
- Added files all sit in the ticket folder (`git diff --diff-filter=A` checked). Nothing project-specific in the kit. Node 18 compatibility holds: only `Object.hasOwn` (16.9+), `fromEntries` and `Map` are used. verification.md records the Node 18 run.
- Ran on Node 22.23.4, one file at a time at `--test-concurrency=2`, box rule env: test/gateway.test.mjs 73 pass, 0 fail; test/hub-overview.test.mjs 15 pass, 0 fail, 0 skipped; test/dashboard.test.mjs 154 pass, 1 fail ("the Library's preview card opens the stage here…", Chrome-driven, `[data-preview] [data-copy]` is null). I re-ran that test with main's hub.html swapped in and it fails identically, so it is unrelated to this PR (pre-existing or environmental); CI is the gate.

Verdict: APPROVE a502a79ade15e4401cb1df1d0b0b764536081df6
