# Plan review, pass 2

- Reviewer: plan-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: 132802d1a214fb0a3ba2683d8ff0b50aefd1a1ae (plan.md; the fixes to plan-1's findings)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Minor | quality.md §3 (a plan a worker can follow without guessing) | T2 "Card" bullet vs the CSS bullet | The CSS bullet now scopes shrinking to `.card-head .pill.shrink` "for the two pills whose words are in `span.t` (Partly blocked, partly held)", but the Card bullet still builds them as `pill amber` and `a.pill.amber.held-pill` with no `shrink` class, and doesn't say that the held pill's words go in `span.t`. If the worker follows the Card bullet, `.card-head .pill { flex: none; }` keeps both from shrinking. The 390px test would catch it, but only after a failed run. Add `shrink` (and `span.t` for the held pill) to the Card bullet. | wont-fix T2 builds both long pills (Partly blocked, partly held) with class shrink and their words in span.t, as the CSS bullet says; the 390px test checks it |

- P1 resolved: the ruling m-20261116-024531651 adds `test/dashboard-shell.test.mjs` to the touches (confirmed in `ticket show`). Global constraints name it, limited to that loop. T2 Step 3b narrows the "no .shell yet" assertion (dashboard-shell.test.mjs:126-127) to index.html and keeps the keyframes check (line 128) over both pages. That matches the ruling's scope, and the change lands in the same commit as `<body class="shell">`.
- P2 resolved: the status pill stays `el('span', \`pill ${S.tone}\`, S.label)` with `S = STATES[st]`, so the literal at dashboard-shell.test.mjs:319 still holds, as it does today at hub.html:919. It is `flex: none`, and only the two long pills shrink (see P2-1 for the leftover wording gap).
- P3 resolved: the loader slices both `T_UNSAFE` (hub.html:1053) and `tLine` (hub.html:1054), and a bidi case proves `T_UNSAFE` is there.
- P4 resolved: an explicit test discipline now covers this. After an ask, the test calls `setList` with the mode the project now has, so the hello agrees and `modeOf` deletes the `fleetSet` entry (hub.html:869-873). A scenario that starts from a different mix reloads first. That handles the Mixed step and the "pressed Run" card step.
- P5 resolved: T2 replaces the box-line string test with `'the Overview draws no box line'`, so the T2 and T3 commits stay green. T4 adds the Settings half.
- P6 resolved: the rule is now written down. Part 0 is "Box release" with `Box ` dropped. Part 1 is "Hub", its whole text, amber from `amber`. Later parts split at the last space, which is safe because `BOX_TOKEN` (hub.html:985) bars spaces in versions. This matches `boxLine` at hub.html:987-998.
- P7 resolved: `!NOTIFY_OK` on a laptop now writes "This browser can't notify from this page" instead of returning empty (hub.html:1721). A string test checks the sentence. That check is light but acceptable for a Minor.
- P8 resolved: the row wrapper carries `pinOn(div, 'fleet', \`Fleet: ${mode}\`)`.
- P9 resolved: T2 adds a 720x800 test that keeps `.hub-body` inside each card. T5's `ready` sets `overflow: visible` on `#overview` and `#settings-view`. `measureAt` navigates at each size and polls `ready` before `measure` (measure.mjs:119-133), and `main`/`body` don't clip (hub.html:197, 216), so `clips()` no longer skips that content.
- P10 resolved: the comparison uses a probe's computed `color` under `var(--red)`.
- P11 resolved: each set or clear calls `paintOverview()` at once, as `confirmed()` does today (hub.html:865).
- P12 resolved: `empty.hidden` treats Settings like the Overview (hub.html:1791).
- P13 resolved (wont-fix): the gateway is outside the touches. The Notes section records it as a follow-up observation.
- P14 resolved: the skip now checks a navigation to `hub.localhost` that ends with `document.title === 'devteam'` (hub.html:6), not a circular fetch.

The diff adds no new Critical or Important defect.

Verdict: APPROVE 132802d1a214fb0a3ba2683d8ff0b50aefd1a1ae
