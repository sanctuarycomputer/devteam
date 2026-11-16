# Task 3 review (the Score section), pass 2: confirm

- Reviewer: task-3 confirm reviewer (fresh subagent, claude-opus-5-5; neither author nor fixer)
- Reviewed: 4de132c6, only the fixes for reviews/task-3.md's T3-1..T3-6 (the diff against 4cc2436e for those lines). test/dashboard-efficiency.test.mjs was run once on Node 22 from a `git archive 4de132c6` extract: exit 0, `# pass 27`, `# fail 0`, `# skipped 0`

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T3b-1 | — | — | — | None. Each of T3-1..T3-6 is fixed (below). | |

- **T3-1: fixed.** 'charts draw when their page comes into view' loads at `#overview` and waits for the hidden card. It asserts no `[data-fit] svg`, then sets `#efficiency` without a reload and waits for both charts. Nothing else calls `fitCharts` when a page is shown: `renderEfficiency` returns early on the same html, and `resize` doesn't fire. So the test fails if the `ResizeObserver` is removed.
- **T3-2: fixed.** 'charts follow new data' changes only `weeks[0].score` and `weeks[0].usd_by_phase` in the live `__fx`. Neither feeds any text on the card, so only `data-v` changes the html. The test asserts that the circles go from 11 to 10 and the slot-0 rects from 3 to 0, so it fails if `data-v` is dropped.
- **T3-3: fixed.** `var(--red)` is out of `EFF_COLORS`. The remaining seven are the series, amber, green and muted tokens, and they still cycle past the end.
- **T3-4: fixed.** `gapPath` writes `M p L p` for a point whose two neighbours are null or missing, and `M` alone at the start of a longer run. The sparkline's path has `stroke-linecap="round"`, so the zero-length segment draws as a dot. The score line's `M` count, the gap measure the tests use, is unchanged.
- **T3-5: fixed.** `renderEfficiency` unobserves each `.fit[data-fit]` in the old card before it replaces `innerHTML`. It uses `FIT_SEEN?.` (null without `ResizeObserver`, and initialised before any render runs).
- **T3-6: fixed.** notes/anchors.md now records the `ResizeObserver` and `data-v` ruling and the colour-list ruling, each with its reason. It also records the `/api/thread-new` ruling for Task 4.

Verdict: APPROVE 4de132c6eafbf2b77e75e8149bff67c20841f68e
