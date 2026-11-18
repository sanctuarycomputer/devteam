# kit-90-overview-goals: verification

- Code head verified: `53525b45` (branch `ticket/kit-90-overview-goals`, origin/main merged at `ff262b5`, v0.64.4). It is `01230e93` plus the Inbox panel race fixes (`f63a94aa`, `68f2d98d`, `53525b45`, below).
- CI: run [44212973063](https://github.com/sanctuarycomputer/devteam/actions/runs/44212973063) at `53525b45`: **success** on attempt 2, every job (gate ci passed in 184.4s), recorded with `devteam.mjs gate ci -- gh run watch 44212973063 --exit-status`. Attempt 1 failed only `kit (22, rest 2/2)`: `test/pane-question.held.test.mjs` 2 typed "late 1" before the held lines. That test is a terminal-pane CLI test that kit-90 doesn't touch, and no kit script changed. The supervisor was told. Earlier: run [44207456864](https://github.com/sanctuarycomputer/devteam/actions/runs/44207456864) at `68f2d98d`, success on attempt 1; run [44188200962](https://github.com/sanctuarycomputer/devteam/actions/runs/44188200962) at `01230e93`, success on attempt 1.
- Earlier CI: run [44168579236](https://github.com/sanctuarycomputer/devteam/actions/runs/44168579236) at `d4a1d0f9`: **success** on attempt 2.
- That run (44168579236) at `d4a1d0f9`: every job green on attempt 2, recorded with `devteam.mjs gate ci -- gh run watch 44168579236 --exit-status`. Attempt 1 failed only `kit (24, chrome 2/2)`, on `dashboard-inbox-panel` 9 ("the review open, the panel still open on Inbox under it", timed out). That test is filed under kit-283-ci-flakes (`m-20261117-201656246-supervisor`), and the failed job was rerun as ruled. More on it below.
- Earlier CI: run [44163292008](https://github.com/sanctuarycomputer/devteam/actions/runs/44163292008) at `cc4f6080`: failure. Its fixes are in the next section.
- On the box, only the touched files were run, one at a time. They ran through `gate test` on `/usr/local/bin/node` (Node 22, Chrome present) with their own HOME, TMUX and every `DEVTEAM_*` unset (`.superpowers/sdd/plan/rt90.sh`). Every run had 0 skipped. The full suite is CI's.

## Local runs at `15d6b999`

| File | rc | pass | fail | skipped |
|---|---|---|---|---|
| `test/dashboard-overview-goals.test.mjs` (new) | 0 | 10 | 0 | 0 |
| `test/dashboard-shell.test.mjs` | 0 | 16 | 0 | 0 |
| `test/next-step.strategy.test.mjs` | 0 | 6 | 0 | 0 |
| `test/dashboard-peek.test.mjs` | 0 | 37 | 0 | 0 |
| `test/dashboard-measure.test.mjs` | 0 | 4 | 0 | 0 |
| `test/dashboard.test.mjs` | 1 | 156 | 1 | 0 |

The one `dashboard.test.mjs` failure is "the Library's preview card…" (`[data-copy]` null). It is the known preview-probe race. It fails at `16fb32c` too, which is main before any kit-90 code: 2 passes and 3 fails there. It is filed under kit-283-ci-flakes (`m-20261117-171642439-supervisor`; observation `m-20261117-171602252`). It is no kit-90 code. If it fails in CI, the run is rerun and cited here.

Command for each row: `bash .superpowers/sdd/plan/rt90.sh test/<file>`. That is `devteam.mjs gate test -- env -u TMUX -u DEVTEAM_… HOME=$(mktemp -d) /usr/local/bin/node --test --test-concurrency=2 test/<file>`.

## The done-whens

| AC | What shows it | Command | Result | Commit |
|---|---|---|---|---|
| 1. Overview | `dashboard-overview-goals.test.mjs` › "overview: header, …": header with `statusPill` at the far right (`unknown` before hello). Section labels Status, Numbers, Autonomy, Goals, Needs you, Commit history, in order and monospace. Nine tiles without a production sensor and ten with one (Bugs merged last, with its title). The Autonomy row: four "–" tiles with no line when the records are null; `n%` with `spark` of its own weeks when patched; a null-weeks gap breaks the line; unpatched, each tile reads `/api/data` at its `SCORE_TILES` place. Commit history: no caption, full width, 12 columns. The vm test checks `scoreOf` against each record's served shape (G1). | `rt90.sh test/dashboard-overview-goals.test.mjs` | 10 pass, 0 fail, 0 skip | `04ba63a7` |
| 2. The step bar | same file › "goals: tabs, two across, cards and Upkeep" (each card's `ol.steps` equals the shell's `goalSteps(goalStepData(g))` for a draft, one waiting on approval, one being built and one at target; the words; done is `--series-1` and now is amber), "overview: header, …" (each goal row's, the same) and "goal peek and Upkeep peek" (the peek's, the same); "the shell blocks are untouched" compares both blocks with `hub.html`'s byte for byte; `dashboard-shell.test.mjs` › "both blocks are byte-identical in index.html and hub.html" passes unchanged | as AC1, and `rt90.sh test/dashboard-shell.test.mjs` | as AC1; shell 16 pass, 0 fail, 0 skip | `04ba63a7` |
| 3. Goals tabs and history | same file › "goals: tabs, two across, cards and Upkeep": Met, through three polls, then Back shows Active; a reload at `#goals?gt=met` shows Met (added at the final check), and one at `#goals?gt=letgo` keeps Let go | as AC1 | as AC1 | `04ba63a7` |
| 4. Goals cards and the peeks | same file › "goals: tabs, two across, cards and Upkeep" and "goal peek and Upkeep peek". Tabs with counts; c6 cards with equal heights, head, step bar, next line, links and Mark met; no `data-hold-id`, Open, Strategy or retro badge. Peek keys in order, then `GOAL_PEEK.goal`'s sections. Upkeep: its keys, including Held because when held ("No reason given" without a reason, `efbd4c8`), and `GOAL_PEEK.upkeep`'s sections; a 14-cell `.heartbeat` and no step bar. | as AC1 | as AC1 | `04ba63a7` |
| 5. The Inbox tab and the Next chip | same file › "the Next chip". The question card's parts sit in one column the panel's width. Exactly two `.chip-next`: the first card and Overview's first Needs you row. With a secrets question first, its card carries the chip and keeps Reply and Can't right now (`efbd4c8`). | as AC1 | as AC1 | `04ba63a7` |
| 6. Hold and Why it matters | same file › "goal peek and Upkeep peek". Hold is Run, Drain, Park, Let go; "Confirm let go" holds 1 s before posting; a let-go goal shows only Restore (parked). Wrong?/Change it posts `{ action: 'correct', body: { id, reason, impact } }`. No impact form on `#ticket/…` or `#goal/upkeep`. | as AC1 | as AC1 | `04ba63a7` |
| 7. The measure | `dashboard-measure.test.mjs` `PAGES` gains `#overview`, `#goals`, `#goals?gt=met`, `#goals?gt=letgo`, `#goal/<seeded>` and `#goal/upkeep`. Each entry's `ready` waits for its content: the peek's loading marker gone and its Opened or What it covers row; Overview's mosaic cells, so hello is in (task-5 T5-1, T5-2). Every check runs at 1440x900, 720x800 and 390x844, with page-top judged at 1440 only, as for kit-100's entry. **The panel's Inbox tab** is measured by kit-100's "the Inbox in the panel at three sizes" in the same file, with a real question, so kit-90's Next chip is on its first card. The plan's T5 Step 1 adds `#overview?th=inbox` only if kit-100 hadn't listed it; the panel doesn't change with the page under it (ruling in the ledger, upheld by task-5 T5-3). | `rt90.sh test/dashboard-measure.test.mjs` | 4 pass, 0 fail, 0 skip | `15d6b999` |
| 8. The mock's inventory | For the final review, one by one. | — | — | — |
| 9. `goalBlock` | same file › the vm cases: each waiting kind gives `full`; one ticket everything depends on (one or two levels) gives `full`; planners at a prompt give `full` but not at a usage limit; a mix gives `partial`; nothing waiting, no work, met, let go or owner-parked gives `null`; another goal's question doesn't count. In Chrome, the full and partial outline colours on the card and the Overview row. | as AC1 | as AC1 | `04ba63a7` |
| 10. Overview goal rows | same file › every row's 1px border is `--line`, or muted red or amber when blocked; rows side by side have equal heights | as AC1 | as AC1 | `04ba63a7` |
| Existing tests | Moved to the new markup with the same intent; the changed steps are listed below. Other named files had no markup hits: `plain-questions`, `multirepo-*`, `fleet-park` and `gateway` have none; `ooda-lineage` and `ooda-learning` hits are a lineage string and an href, both passing (10/10 and 5/5 at `b3a7f874`); `test/lib/kit.mjs` and `chain.mjs` hits are CLI kinds. | the rows above; CI | see the local runs | `15d6b999` |

## CI run 44163292008 at `cc4f6080` (failure) and its fixes

Every touched file passed. Three outside files failed; two were caused by the taller Overview and reproduce on the box:

- **`dashboard-threads-sidebar` 1 and 6** (Node 22 and 24). At 720x800 and 390x844 the new Overview is taller than the window, so the document draws a 15px scrollbar (box probe: `innerWidth` 720, `clientWidth` 705). The panel is `--threads-w: 100vw` at 900px and below (the shell's layout block), so its left edge sat at -15. The fix is page CSS outside both shell blocks: at 900px and below, `html` doesn't scroll while the panel is open, since the panel is the whole window there. `398635d3`. Locally: threads-sidebar 8 pass, inbox-panel 12 pass, shell 16, measure 4, overview-goals 10, all 0 fail and 0 skip.
- **`dashboard-pages` › "settings area"** (Node 22 and 24). The click helper scrolls its button into view. Overview is now 1014px tall at 1440x900, so the first press scrolled it by 114 and the sticky nav's switch moved 0.5px. The place is now read after the first press (Run, which posts nothing). The assertion is unchanged. Added to touches by `m-20261117-201656246-supervisor`. `b850bfc8`. Locally: 6 pass, 0 fail, 0 skip.
- **`dashboard-inbox-panel` 9** (Node 22 only): a timeout. It passes on the box (12/12) and is no kit-90 code. It is filed under kit-283-ci-flakes (`m-20261117-201656246-supervisor`). The failed job is rerun if it recurs.
- **More on `dashboard-inbox-panel` 9.** It failed in 2 of the 4 Chrome jobs that ran it across both runs, once on Node 22 and once on Node 24. None of the last 24 failed CI runs on main or other branches had it. On the box it passes at normal speed: 12/12, and 3/3 on the narrowed pattern. With the CPU throttled 6x, the "Open the review" press failed to open the review in 1 of 7 kit-90 runs, and it opened in 3 of 3 main runs. A trace on one throttled run showed a data load rewriting the whole Inbox (`render` → `$('questions').innerHTML`, not new in kit-90) inside the press. The cause isn't proven. The supervisor was told (`m-20261117-211948359`).

## Final review 1 (CHANGES at `102b6437`) and its fixes

- **F1 (Important), `b6e2b88f`.** A met goal's card wrote its measure description without `esc`, which was stored XSS. Now it is `esc(cap(…))`. The fixture's met goal has `<img src=x id=probe-xss>` as its measure, added through the real `goal add`. The test asserts the measure shows as text and that no `#probe-xss` element exists; it fails without the fix. All 60 new interpolations were checked, and this was the only unescaped log text.
- **F2 (Minor), `d342a49f`.** The render cost the supervisor asked about.
  - The first render costs the same as main's.
  - The mosaic uses one shared `Intl.DateTimeFormat` and reuses its HTML while the activity and the day are unchanged. `helloLoad` redraws Overview only when the answer changed. Both live in a `hello-pulse` marker block, with vm tests.
  - `renderOverview` went from 8–14 ms twice a poll to 1–3 ms once a poll. `ovMosaic` went from 6–10 ms to about 0.1 ms.
  - On this fixture main's `render()` averages 44–65 ms, with the same 60–100 ms spikes, in `renderOoda` and `renderProgress`, which kit-90 does not change. kit-90's own share is now about 2 ms.
- **F3 (Minor), `f8d54531`.** A goal card's `planner on …` link, its "stuck on a prompt" badge and its registry line are asserted. Each assertion fails if its part is removed.
- **F4 (Minor), `45da205b`.** `helloLoad` applies only the latest request's answer. The vm test answers two requests out of order.
- **F5 (Suggestion), `01230e93`.** Settings area scrolls Run into view without pressing it, reads the place, presses Run and asserts the switch didn't move. A 6px shift on Run fails it.
- Local runs at `01230e93`, each 0 fail and 0 skip: `dashboard-overview-goals` 12, `dashboard-shell` 16, `dashboard-pages` 6, `dashboard-measure` 4, `dashboard-inbox-panel` 12, `dashboard-threads-sidebar` 8.

## The Inbox panel race (merge refused at `8cd73123`, `m-20261117-223956214-supervisor`) and its fixes

`dashboard-inbox-panel` failed in 4 of 6 CI job runs on this branch; main passed. In each failure a press on a panel or peek control didn't take. A throttled harness (6x CPU, two copies) and deterministic probes found three causes. All three are older than kit-90, but kit-90's longer renders keep the page busier, which widens their windows:

- **Subtest 6, the peek's × moved under the pointer.** When the peek's read landed after its first draw, its content grew past the window. The drawer then got a classic 15px scrollbar, which narrowed its sticky head and moved × from x=690 to 675 between the test's read and the press. Fix: `.drawer { scrollbar-gutter: stable; }`, page CSS outside the frozen block (`f63a94aa`). A probe moved 15px before the fix and 0 after.
- **Subtest 4, a press acted on a stale panel state.** Closing a floating card writes its head at once, but TH is routed only on the hashchange, 86 ms later in one run. A Threads tab press in between reopened the closed thread (`#goals?th=open&t=Q`). Fix: `thSync()` routes TH first when the entry is thGo's own and not yet routed. `thGo` and the tab bar call it (`f63a94aa`). final-4's F4-1 found that the first guard also routed fresh entries such as a nav link, which closed and forgot the remembered panel. It now acts only on the entry `TH_FRESH` marks as thGo's own and not fresh, because in Chrome a `location.hash` write fires `popstate` at once, which clears `TH_MADE` (`53525b45`). Test: `dashboard-overview-goals` › "a tab press before the hashchange acts on the head in force". It presses in the same task as the head write. The nav-link half fails with `68f2d98d`'s guard; the thGo half fails with `thSync` off.
- **Subtest 9, the test's own race.** It removed the terminal's card (`__pane = null`) and pressed Open the review without waiting. The card, about 280px tall, could go between the press's read and the press. The test now waits for the card to go, as every other `__pane` change in the file does (`68f2d98d`). `test/dashboard-inbox-panel.test.mjs` joined touches for this one line (`m-20261118-000840933-supervisor`).
- **Evidence.** The throttled harness after `f63a94aa` passed 10/10 full-file runs: 12 pass, 0 fail, 0 skip each. Then the box hit its memory ceiling, so runs were one at a time at `--test-concurrency=1` (`m-20261118-000454008-supervisor`). Local at `53525b45`, each 0 fail and 0 skip: `dashboard-overview-goals` 13, `dashboard-threads-sidebar` 8, `dashboard-inbox-panel` 12. At `68f2d98d`: `dashboard-shell` 16 and `dashboard-peek` "the frame" 16. The full `dashboard-peek` run on the loaded box failed 2 in "the frame"; alone it passed 16/16, and CI passed it.
- **Reviews.** `final-4.md`: CHANGES at `68f2d98d` (F4-1). `final-5.md`: APPROVE, confirming F4-1's fix.

## What the supervisor asked to have named here

- **The spec and plan amendment `e7d4c79`**, made per the spec's own build clause, with no delta review (`m-20261117-144551912-supervisor`). It made two changes:
  1. Autonomy Score's % is read at `autonomy_score.this_week`. kit-242 serves it as `{this_week, last_week, weeks}` with no score object. `SCORE_TILES` gained a third column naming each tile's % place, and `scoreOf(rec, at)` takes it.
  2. The Autonomy line is the page's existing `spark(v, label)` (kit-174's, a path broken at each null week), reused in place of the planned polyline.
- **Three outside test files added to touches**, each moved to the new markup with the same intent:
  - `test/dashboard-shell.test.mjs` (`m-20261117-151250010-supervisor`): `goals` and `overview` are dropped from the no-shell list, and the test asserts `goalStepper` is gone.
  - `test/next-step.strategy.test.mjs` (`m-20261117-152227607-supervisor`): the Strategy link is asserted gone from Goals and checked in the peek's Why it matters.
  - `test/dashboard-peek.test.mjs` (`m-20261117-152227607-supervisor`): Let go moved to the goal peek's Hold, with `dt:Measured by`. The stepper fenced check now asserts the shell's step bar. The ⋯ check skips Upkeep, whose menu is new.
- **`.sec` follows the shell contract** (`m-20261117-160508016-supervisor`): `test/contracts/shell.md:57`, a `.lbl` label then a `.sec-b` body. Spec line 26 was amended to say so in `8db3914`.
- **The Library preview flake**: see the local runs above.

## Other spec changes during the build

- `548085e` (task-4 T4-1): spec line 62 names the goal peek's section cards as built (Readings, TL;DR, Problems, Decisions and acts, Progress). kit-88's computed rows (Design, Forecast, Features, Planners, Your verdicts, Questions) stay rows, as its inventory test and the mock keep them.

## Changed steps in `test/dashboard.test.mjs` (T5)

- Shift+click on `#goals h2` is now on Goals' Active tab, because the h2 is gone. It is still a spot that is no item, so the subject is `page`.
- Two redraw steps set `GOALS_HTML = ''` before a poll. Goals redraws only when its HTML changes, so this makes the poll redraw the card, as a change would. The assertions after them are unchanged.
- The "Goals page again, at rest" wait also waits for the panel's `margin-right` slide to end. Otherwise the next click could land on Upkeep's card beside the goal.

## Page CSS from the measure (T5, outside both shell blocks)

- A closed ⋯ menu's pop takes no space on Goals. This extends kit-100's `#th-inbox` rule.
- Goals' tab bar and Overview's header start 42px below the bar, as the shell's `.page > :first-child` rules do for direct children.
- A long held-goal badge ends in an ellipsis in the card head and Overview's row, and carries a `title` with the full label (T5-4). The full state is in the peek.

## Reviews

| Task | Records | Outcome |
|---|---|---|
| 1 | `task-1.md` CHANGES, `task-1-2.md` APPROVE `b0a10a0` | T1-1..5 fixed |
| 2 | `task-2.md` CHANGES, `task-2-2.md` APPROVE `86102f6` | T2-1, T2-2, T2-5 fixed |
| 3 | `task-3.md` APPROVE `0da7ab4` | T3-1 fixed `fed3d20` (covered by task-4's package) |
| 4 | `task-4.md` APPROVE `6482a31` | T4-1..3 fixed `548085e`, `efbd4c8` (covered by task-5's package) |
| 5 | `task-5.md` CHANGES, `task-5-2.md` APPROVE `f3be0c2c` | T5-1, T5-2, T5-4 fixed `f3be0c2c`; T5-3 in AC7 above |
| Final | `final-1.md` CHANGES `102b6437`; `final-2.md` APPROVE `bdab5149`; `final-3.md` APPROVE `b4f60748` (records); `final-4.md` CHANGES `68f2d98d`; `final-5.md` APPROVE | F1..F5 fixed `b6e2b88f`..`01230e93`; F4-1 fixed `53525b45` |
