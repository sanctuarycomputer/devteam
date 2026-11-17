# kit-89 verification

CI: GitHub `test` workflow on PR #314, run 43987900673 at e7713775271ef0b917776c033b14884dba533b96 (code at a1f61ee, the final-1 fixes), every job green (`devteam.mjs gate ci -- gh run watch 43987900673 --exit-status`, exit 0; `gh run view 43987900673 --json conclusion` = `success`). Local runs: Node 22 (`/usr/local/bin/node`; the PATH node 18 skips Chrome tests), a throwaway `HOME`, `DEVTEAM_*` unset, `timeout 900 … --test --test-concurrency=2 <file>`, one file at a time, judged by exit code, 0 skips.

| # | Done-when | Shown by | Result | Commit |
|---|---|---|---|---|
| 1 | Panel from the top-right Inbox button; `th=inbox` still opens Inbox; pushes the page by `--threads-w`; button hides while open, × closes; tab bar `--bar-h`, level with the page bar; Threads (Open / Resolved) + disabled Supervisor and Shell via `threadsTabs` | `test/dashboard-threads-sidebar.test.mjs` "the panel and its button" | pass in CI; local 8/8 | a1f61eeb |
| 2 | A subjectless thread opens in the panel with a back arrow; a Shift+click thread floats beside its pin and is listed with pin and subject; its row goes to its page and opens the card | same file, "opening threads" | pass in CI | a1f61eeb |
| 3 | Inbox red count + thread count coloured green / blue / grey; blue your-move count on the Threads tab; three row marks with tooltip and accessible name, no explanatory line; dock gone | same file, "the panel and its button", "the counts as threads move" | pass in CI | a1f61eeb |
| 4 | With the viewer up, `#tt-peek` floats above it and opens the panel beside it; backdrop `--backdrop`; `--av-right` = `calc(var(--threads-w) + 16px)` above 900px; overlay below 900px; with a peek: drawer right = panel left ±1, scrim off the panel, three bars level | same file, "with the viewer" | pass in CI | a1f61eeb |
| 5 | `test/dashboard.test.mjs`' threads-core and threads-layer vm tests pass | `test/dashboard.test.mjs`; `threads-core` block byte-identical to main (md5, checked in each task review) | pass in CI; local 157/157 | a1f61eeb |
| 6 | Reload with a peek and a thread open reopens both (`history.state` keeps `th`, `t`) | sidebar file, "a peek and a thread over a reload" | pass in CI | a1f61eeb |
| 7 | Reload keeps the panel on its thread (`th`, `t` in the URL; `devteam.threads.open` for a fresh visit); Back after opening a thread returns to the list | sidebar file, "reload and Back" | pass in CI | a1f61eeb |
| 8 | `test/dashboard-measure.test.mjs` with the list, a thread and a floating card at 1440, 720, 390 on every check | three entries `#overview?th=open`, `#overview?th=open&t=<A>`, `#goals?t=<G>` (panel and card are overlays the measure leaves out by design, spec AC8) | pass in CI; local 3/3, no CSS change needed | a1f61eeb |
| 9 | Gap-audit rows: Pin starts a thread by pointing without Shift; a resolved thread has Reopen; Shift+Enter sends a reply or a new thread | sidebar file, "the gap-audit rows" (own fixture) | pass in CI; local 8/8 twice | a1f61eeb |

Also run locally at each task: `test/dashboard-pages.test.mjs` 6/6, `test/dashboard-peek.test.mjs` 37/37, `test/pane-question.answer.test.mjs` 12/12, `test/dashboard-efficiency.test.mjs` 28/28, `test/dashboard-owner-action.test.mjs` 6/6. `test/browser/dev-links.mjs` (hand-run, not CI) moved to `.tt` → Resolved → the row in T1; not run here.

Earlier green runs: 43980260508 at 01cfa8a, 43982703210 at 9bebad8. One red run, 43977970837 at d856e13: `dashboard-pages` "threads on pages" clicked the Inbox button while the page slid back; fixed by a wait at 01cfa8a (assertions kept).

Final review pass 1 (`reviews/final-1.md`, CHANGES at f40dc91) fixed at a1f61ee: Escape from the page (focus on `<body>`, no peek) closes a floating card, then the panel (spec §2.9), shown by new steps in the sidebar file that failed at f40dc91; the Inbox button's label counts what the red number shows; the `dispose-*.sh` helpers removed. Local at a1f61ee: sidebar 8/8, `dashboard.test.mjs` 157/157, `dashboard-pages` 6/6, `dashboard-peek` 37/37, `pane-question.answer` 12/12, 0 skips.

## Rulings

- `m-20261115-203750802-supervisor`: plan ahead; build after kit-88 and approve-plan. `m-20261115-214130183-supervisor`: approve-spec and approve-plan at 15b7415. `m-20261116-180032225-supervisor`, `m-20261116-181230392-supervisor`: kit-88 and kit-245 merged; main merged at 872d503, 8ce9be6, 893370c.
- `m-20261115-204940196-supervisor`: `test/pane-question.answer.test.mjs` in touches; its dock check moved to the panel, assertion kept.
- `m-20261115-205924178-supervisor`: `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs` in touches, assertions kept, navigation changed. `m-20261115-210541487-supervisor`: `test/browser/dev-links.mjs` in touches.
- `m-20261115-232720840-supervisor`: kit-241 followed; its test lines moved, no plan step changed (plan "As merged (T0)").
- `m-20261115-214235790-supervisor`: review rounds capped.

## Departures and calls (each in a task review)

- **kit-87 assertions changed where the approved spec changes the behaviour** (`test/dashboard-pages.test.mjs`; judged per assertion in task-2 and task-3 reviews): a `talk/` link to a gone-subject thread opens in the panel over the page it was clicked on (§2.4, §2.5); a Board thread's row lands on `#board?th=open&t=<id>` and × drops `t` as a new entry (§2.5); a `talk/` link to a thread with a subject adds `t` to its page head (§2.5: `#board?t=…`, `#loop?lt=orient&t=…`, `#sensors?t=…`). One assertion of `test/dashboard.test.mjs` changed for the same reason (`#goals?t=<T>`).
- **Pins open in place, no entry** (task-3, T3-1): spec §2.4 ("A pin still opens its thread's card in place") over §2.5's list; kit-87's three pin assertions kept as they were.
- **`/view/` counts** are written to `.tt` and copied to `#tt-peek` by kit-88's observer (task-4, T4-2): spec §2.8 said `thDraw()` writes `#tt-peek`; the copier would overwrite a direct write, and the result on screen is the same.
- **A viewer whose frame has its own history** can leave saved Threads keys pending until the next route on the same page (task-4, T4-4; the same exposure as the peek's, task-3).
- **Pin mode stays on after a thread starts** until Esc or Pin again (today's behaviour; done-when 9 asserts that and that Esc ends it).
- **Test waits added under load** (navigation only, assertions kept): the Inbox button at rest before a click (`dashboard-pages` "threads on pages", which failed CI once at d856e13 by clicking while the page slid back), the panel hidden before a click in `pane-question`, the page settled before a Resolve press in `dashboard.test.mjs`.
- `test/operator-threads.hub.test.mjs` still drives `#tl-pill`: it tests `hub.html`, which has its own dock; unaffected (task-5 review).
