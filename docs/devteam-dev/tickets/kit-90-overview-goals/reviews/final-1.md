# Final review, pass 1

- Reviewer: fresh opus subagent (claude-opus-5-5), not the author; had not seen the build
- Reviewed: 102b6437463e56805a911f5f2ab0ac1cb2df98be (the whole branch, `git diff ff262b5b..102b6437`), read and run in the detached tree `.worktrees/review-kit-90-102b6437-final1`

## What was checked

- **§1.1 done-whens.** `test/dashboard-overview-goals.test.mjs` run at the head: rc=0, 10 pass, 0 fail, 0 skipped (Node 22, throwaway HOME, TMUX and every `DEVTEAM_*` unset). The tests match done-whens 1–6, 9 and 10 assertion by assertion. Done-when 7 is the measure entries plus kit-100's panel entry, as ruled. Six mutations, each run against its own test and then restored:
  - M1: `goalBlock`'s transitive loop off (`grew = false`). `goalBlock` vm test **fails**.
  - M2: a question with a default counts as waiting. `goalBlock` vm test **fails**.
  - M3: Trust's % read at `this_week` instead of `score.this_week`. `scoreOf`, golden and Chrome Overview tests **fail** (3 of 3).
  - M4: Hold confirm not kept in page memory (`sure = false`). "goal peek and Upkeep peek" **fails**.
  - M5: no Next chip on the Inbox card. "the Next chip" **fails**.
  - M6: `showHead` doesn't take `gt` from the hash. "goals: tabs…" **fails**.
- **§1.7 rulings.** I listed every log message to `kit-90-overview-goals` and checked each against the spec and plan Rulings. Each ruling is there. The 2026-11-15 22:39 restatements ("as given earlier") are covered by `m-20261115-204822283`. The other messages were status notes, restart notices or review requests for other tickets, not rulings.
- **§1.8 lint suppressions.** None added in the diff (no `eslint-disable`, `@ts-ignore`, `biome-ignore`, `noqa` or bare `doctrine-exception`).
- **Frozen shell blocks.** `devteam-layout` and `devteam-shell-js` hash the same at ff262b5b and at the head (sha1 b373f3c2… and be14ac71…). `hub.html` is untouched. "the shell blocks are untouched" passes.
- **Touches (§1.9).** Every changed file is in touches or in `docs/devteam-dev/tickets/kit-90-overview-goals/`.
- **Escaping.** I went through every new interpolation. One is not escaped (F1). I proved it in Chrome: `closedGoalCardHtml` with a measure description of `<img src=x id=probe-xss>` creates the element.
- **Test changes outside the new file.** Each moves an assertion to the new markup with the same intent: the peek's Let go, `Measured by`, the step bar no longer fenced, `goalStepper` asserted gone, and the Strategy link asserted gone with the link now checked in Why it matters. The two `GOALS_HTML = ''` lines in dashboard.test.mjs force the redraw the test is about. The settings-area change is F5.
- **CI fix 1, `html:has(> body.threads-open) { overflow: hidden }` at ≤900px.** Probe at 390x844 on a tall Overview: scroll to 400, open the panel, close it.
  - With the rule: scrollY 400 → 400 while open (overflow hidden, clientWidth 390) → 135 after closing.
  - Without the rule: 400 → 400 → 135, but clientWidth is 375 while open. That 15px scrollbar is the bug the rule fixes.
  - So the rule fixes the 15px scrollbar and adds no scroll loss of its own. The drop to 135 on close happens with or without it.
  - It only matches at ≤900px, while the panel covers the whole window. I found no other side effect.
- **CI fix 2, settings area.** It reads the switch's place after the first press (Run, which posts nothing). The no-move assertion still covers Drain. It no longer covers Run's press (F5).
- **The supervisor's render-cost question.** See "Render cost" below and F2.

## Render cost (the supervisor's question)

Method: a throwaway test that wraps `render`, `renderOverview`, `renderGoals`, `renderOoda` and their helpers with performance.now() timers. Setup: `#overview` at 1440x900 on a bare project with 4 goals and 1 question, polls at 10 s, about 32 s idle. The same probe ran against ff262b5b's index.html.

Per-call `render()` times, ms:

| Run | render calls | renderOverview calls |
|---|---|---|
| main ff262b5b | 183, 8.8, 7.0, 11.6 | (none) |
| kit-90, run 1 | 199.3, 105, 78.1, 15.6 | 13.2, 13.1, 14.7, 16.3, 73.2, 85, 9 |
| kit-90, run 2 | 202.7, 94.5, 80.9, 17.6 | 89.6, 10.3, 84.3, 7.9, 8.7, 15.7, 11.8 |
| kit-90, run 3 (finer wraps) | 177.8, 15.8, 63.5, 13.1 | 13.7, 7.1, 9.5, 8.5, 10.5, 7.6, 7.0 |
| kit-90 with renderOverview taken out of render | 87.4, 68.2, 6.2, 5.2 | the hello-driven calls, one of which took 80.9 (ovMosaic 78.7) |

What the numbers show:

- **The first render costs the same on main and kit-90**, about 180–200 ms. That is first data and first layout, not kit-90's. Excluding it, kit-90's average is about 50 ms against main's 9 ms.
- **The steady cost is every render.** renderOverview runs twice per 10 s cycle: once from `helloLoad` (line 7914 → 5793) and once from `render` (5921). Each call takes 7–14 ms, even when nothing changed and `ovSet` writes nothing.
  - 70–90% of that is `ovMosaic` (6–10 ms a call). It calls `new Date(...).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })` once per cell, 84 times a call, which builds an Intl formatter each time. It builds the whole string before `ovSet` compares it.
  - `renderGoals` costs 1–4 ms. goalBlock, goalState, spark and forecast are under 1 ms in total.
- **The 60–100 ms spikes come and go, and are not tied to one function.** In run 3 a 63.5 ms render had only about 15 ms in its wrapped parts. With renderOverview out of render, one ovMosaic call alone took 78.7 ms.
  - The pattern fits garbage collection or Intl work triggered by the allocation churn above. They showed in 6 of 12 non-first kit-90 renders and in none of the 3 on main.
  - So it is kit-90's, mostly through ovMosaic and the duplicate Overview draw. Goals' first draw is not the cause.
- **Verdict on it:** a real regression with a cheap fix: one hoisted `Intl.DateTimeFormat`, and skip the mosaic, or all of Overview, when hello's `activity` and the inputs haven't changed. No done-when or rule sets a render budget, so it is Minor (F2), not blocking on its own.
- **inbox-panel 9.** The trace in verification.md shows a data load rewriting the Inbox during the press, and the throttled runs failed 1 in 7 on kit-90 against 0 in 3 on main. Longer renders on kit-90 widen exactly that window. I can't prove the link, but I would not rule kit-90 out. Fixing F2 is the cheap way to find out.

## The mock's inventory (done-when 8)

| Item | Where in the code | Where tested |
|---|---|---|
| Ten stat tiles (done, forecast finish, workers active, blocked, median cycle, cost per ticket, spend, open questions, answer rate (14d), escaped defects → "bugs merged") | `renderOverview` `stats`, index.html ~5847–5858 (bugs merged only with a sensor, with its hover and icon) | overview-goals › "overview: header…": nine without a sensor, ten with one, order, hover, icon, value = `metrics.escaped_defects` |
| Down banner | `#down-banner` kept inside `#overview` above `#ov-secs` (line 1017), filled as before (~4368) | overview-goals: inside Overview and before the first `.sec` |
| Upkeep card | `upkeepCardHtml` ~3238: hold badge, "always on" / "the fleet is …", 14-day heartbeat, chores in flight; opens Upkeep's peek | overview-goals › "goals…" (always on, 14 cells, bad, l4, quiet, today's hover, no step bar, no `data-hold-id`), "goal peek…" (opens the peek) |
| Goal cards: head, step bar, next line, links | `goalCardHtml` ~3446 | head text, `ol.steps` equal to the shell's, `.goal-next`, "Read the design"; no Open, Strategy or retro |
| Goal cards: planner links | `goalCardHtml` line 3452 (`planner on …`, "stuck on a prompt"), unchanged | **not tested** anywhere (F3); present in code |
| Goal cards: Mark met | `goalCardHtml`, `data-met-id` on an at-target ready goal, its confirm handler unchanged | overview-goals: Mark met only on g3 (no test of its confirm or post in this ticket, but that code is unchanged) |
| Question card, every part (head and ⋯ menu, why chips, choices with Recommended, note box, standing rule, Next time, default and deadline, Answer/Send/Post, Reply, Can't right now, Why you) | `questionCard` / `reviewCard` unchanged except the `nextChip` before the badge (2390, 2640) | overview-goals › "the Next chip": choices, textarea, Answer, head ⋯, h4, one column at the panel's width, secrets card's Post, Reply and Can't right now. The rest is unchanged code, covered by the existing Inbox tests (dashboard-inbox-panel, next-step.strategy) |
| Next chip | `nextChip` 2365; Overview row 5880 | overview-goals: exactly two chips, on the card for `NEXT_ID()` and on the first Needs you row; mutation M5 caught |
| Lesson cards (Keep it, Retire it) | unchanged, index.html 5940 | dashboard.test.mjs 514, dashboard-owner-action 161 (not touched by kit-90) |
| Answered list | unchanged, `#answered-sum` 5951 | dashboard-inbox-panel 147, 501, 585 (not touched by kit-90) |
| Review-page and secrets cards | unchanged, plus the chip | overview-goals: secrets card as Next |
| Moved, as asked: Run/Drain/Park/Let go, the confirm, Restore | goal peek Hold row (`openGoal` front), `HOLD_CONFIRM` | overview-goals › "goal peek…": order, confirm held through polls and a full redraw, post body, Restore only; M4 caught |
| Dropped, as asked: Strategy link, retro badge | `#goals` header removed | overview-goals and next-step.strategy |

Every item on today's page is still on it. One gap in tests: the planner links on goal cards (F3).

## Findings

| ID | Severity | Where | Finding | Disposition |
|---|---|---|---|---|
| F1 | Important | docs/devteam/dashboard/index.html:3470 (`closedGoalCardHtml`) | The Met card's measure line puts `cap(m.description \|\| 'the measure')` into HTML without `esc`. `cap` only capitalises (line 2051). A goal's measure description is log text (`goal add --measure`, written by agents), and every other place escapes it (`ATTR.goal.fmt.measure`). A browser probe showed `<img src=x id=probe-xss>` becomes a live element on the Met tab. That is stored XSS in the owner's dashboard, which can post owner actions (quality.md §3 "a security hole"; the brief's "every interpolation escaped"). No test covers markup in a description. Fix: `esc(cap(...))`, plus a test with `<` in the description. | |
| F2 | Minor | index.html:5805–5812 (`ovMosaic`), 5921 and 7914/5793 (renderOverview from both render and helloLoad) | Render cost (the supervisor's question; numbers above). Excluding the first render, kit-90's renders average about 50 ms against main's 9 ms, with spikes of 63–105 ms. The steady part is about 8–10 ms per renderOverview call, twice per poll. Most of it is 84 `toLocaleDateString` calls a draw, building a string that is usually unchanged. The first render (~190 ms) is the same as main's. Fix: hoist one `Intl.DateTimeFormat`, and skip the mosaic or Overview when hello's activity and the data are unchanged. | |
| F3 | Minor | test/dashboard-overview-goals.test.mjs, "goals: tabs…" | Done-when 4 lists the card's "links". The test checks only "Read the design". No test anywhere asserts a goal card's `planner on …` link, its "stuck on a prompt" badge or the registry attestation line, so moving the card could drop them unnoticed. The code is present (line 3452). | |
| F4 | Minor | index.html:5786–5794 (`helloLoad`) | Each poll and each `loadNow` starts a hello fetch with no sequence guard. A slow earlier answer can land after a newer one and overwrite `HELLO`, so the pill and mosaic can show stale data for one cycle. | |
| F5 | Suggestion | test/dashboard-pages.test.mjs:563–567 | `at0` is now read after the Run press, so the test no longer checks that pressing Run leaves the switch where it was. Drain still checks it. The reason is sound (a tall Overview scrolls under the click). Reading the place after a scroll that doesn't press anything would keep the Run check. | |

Verdict: CHANGES 102b6437463e56805a911f5f2ab0ac1cb2df98be
