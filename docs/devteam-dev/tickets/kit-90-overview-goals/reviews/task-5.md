# Task 5 review, pass 1

- Reviewer: task reviewer (fresh subagent, claude-opus)
- Reviewed: b3a7f87 (Task 5 Steps 1–3 and the Task 4 Minor fixes, 6482a31..b3a7f87)

Spec compliance: Partial. PAGES gains #overview, the three Goals tabs, a seeded goal's peek and Upkeep's peek, and every check passes at the three sizes (page-top only at 1440, the kit-wide gap kit-100's Inbox entry also has; `view` feeds only page-top in test/lib/measure.mjs). The goal peek's `ready` does not wait for the peek's record, though, so at 1440 the peek is measured half-drawn (T5-1).
Quality: The page CSS is clean. Every index.html hunk (875, 941–961, 4499) falls outside `devteam-layout` (46–206) and `devteam-shell-js` (1201–1473), and "the shell blocks are untouched" passes. The dashboard.test.mjs moves keep their intent.

Checked:
- Frame-only list. 'overview' and 'goals' leave it correctly: both sections no longer carry `.no-shell`, so the default view judges them whole.
- `shiftClick('#goals .tabbar [role="tab"][data-tab="active"]')`. The target is still a spot on Goals that is no item (no `data-subject`, so it resolves to a `kind: 'page'` spot). The assertions after it are unchanged. If the click got through, it would hit an already-selected tab, and the later `history.state.depth === 1` assertion would catch a stray entry.
- The two `GOALS_HTML = ''` nudges. `renderGoals` now writes only on change (index.html 3495). The nudge makes a real poll do the redraw, and `polls >= n+2 && !__g.isConnected` and the pin re-placement assertions are unchanged. Nothing is loosened.
- The animation wait. It only waits longer (margin-right transition settled). It asserts nothing.
- efbd4c8. The Held because fallback reads "No reason given" in a muted span. The secrets-card test patches a real secrets question in first.
- The badge ellipsis. Every held label starts with the hold word (`goalState`: `${words}${running} · …`), so a held goal's badge still says it is held (spec "A held goal: its badge says so"). With flex-shrink weighted by basis, even a very long title leaves the badge its first word.
- Controller ruling on `#overview?th=inbox`. It holds. Plan T5 Step 1 adds it "only if kit-100 hasn't already listed it". kit-100's "the Inbox in the panel at three sizes" (same file) measures the panel's Inbox tab at three sizes over a real inboxFixture with an open question, so kit-90's Next chip is on its first card, and every check except narrow page-top runs, the same as for the new entries. The panel and the Inbox tab don't change with the page under them, so a second entry over Overview would measure the same element. Done-when 7 says "PAGES gains", and the evidence lives in a sibling test of the same file, so verification.md should name it (T5-3).

Probe of the `ready` conditions: the file was instrumented in place and restored. When each original `ready` first held, the probe recorded the page state, then waited for the full content:
- `#goal/<seeded>` at 1440: `#drawer-body .loading` present, keys `ID|Status|Hold|Priority|Why it matters|Measured by|How it changes|Record|State`. No Opened, and no stored rows (Title, Outcome, Horizon, Preconditions, Not in scope). At 720 and 390 the record was already in.
- `#overview`: `HELLO.pulse` was present at all three sizes in this run. It is order-dependent, because the dashboard's /api/hello answers from a background run that has finished by the time #settings and the frame pages have been measured.
- With `ready` strengthened to wait for both, the test still passes (rc=0), so neither gap hides a failure today.

Mutation checks (in place, restored with `git checkout`):
- `openUpkeep` fallback back to `''`: "goal peek and Upkeep peek" fails at the PEEK_KEYS deepEqual (no 'Held because').
- `nextChip` kept off cards with `q.secrets`: "the Next chip" fails, timing out at "the secrets card, next, with its chip".

Runs (rt90.sh, node 22, own HOME, one file at a time):
- test/dashboard-measure.test.mjs: rc=0, 4 pass, 0 fail, 0 skipped.
- test/dashboard-overview-goals.test.mjs: rc=0, 10 pass, 0 fail, 0 skipped.
- test/dashboard-shell.test.mjs: rc=0, 16 pass, 0 fail, 0 skipped.
- test/dashboard.test.mjs with PAT='threads on the dashboard page': rc=0, 34 pass, 0 fail, 0 skipped.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T5-1 | Important | plan T5 Step 1 ("each with `ready` waiting for its content"); done-when 7 | test/dashboard-measure.test.mjs `GOAL_PEEK_READY` | The goal peek's `ready` holds while the record is still loading. Observed at 1440: `#drawer-body .loading` present, no Opened row, none of the stored rows, and no History content. So at 1440 the measure never judges the rows kit-90 reordered after How it changes, nor the record's rows and History. A prose, head-h or head-end break there would pass. Fix: add `!document.querySelector('#drawer-body .loading')` and, for a goal, an `Opened` dt (the wait dashboard-overview-goals.test.mjs already uses). Checked: the test passes with that added. | fixed: the goal peek's ready waits for no loading marker and an Opened row, Upkeep's for its What it covers row; confirmed in task-5-2 (f3be0c2c) |
| T5-2 | Minor | plan T5 Step 1 | test/dashboard-measure.test.mjs `OV_READY` | Overview's `ready` (an h2 and a `.sec`) doesn't wait for /api/hello, which draws the status pill and the Commit history mosaic (`helloLoad` re-renders when it lands). It held in this run only because earlier entries warmed the server's hello. If the list order changed, or the server were fresh, Overview would be measured with an empty mosaic. Add `!!document.querySelector('#overview .mosaic > i')`. | fixed: Overview's ready waits for the mosaic's cells, so hello is in; with the clause removed and hello delayed it measured 0 cells (task-5-2, f3be0c2c) |
| T5-3 | Suggestion | done-when 7 | verification.md (Step 4) | The ruling to leave out `#overview?th=inbox` holds (see Checked). Done-when 7 literally says `PAGES` gains the panel's Inbox tab, so the done-when-7 row in verification.md should cite kit-100's "the Inbox in the panel at three sizes" run as the evidence for that clause, so the final reviewer doesn't read it as missing. | |
| T5-4 | Suggestion | spec §3 (a goal card "keeps today's head (state badge…)") | index.html 950, goal card and Overview row badge | The ellipsis keeps the hold word but can cut the rest of a label at 720/390, for example the "behind" in "Milestone 2 of 2: being built, behind", with no hover to read it. A `title` with the full label on that badge would keep it one hover away. | fixed: both state badges carry title with the full label; asserted on five cards and five rows, failing with the titles removed (task-5-2, f3be0c2c) |

Verdict: CHANGES b3a7f874b7aa1a5179cc095d9f4bfef1ccc428e3
