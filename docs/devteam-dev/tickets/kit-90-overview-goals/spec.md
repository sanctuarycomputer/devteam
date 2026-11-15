# kit-90: Overview and Goals

Ticket `kit-90-overview-goals` (kind `build`, size M, risk normal), feature `dashboard-cleanup`, story `DCL-S5`, design `project/designs/a-cleaner-more-consistent-dashboard.md` (home), sections "Overview and Goals", "The side peek" (goal entry, action rule) and "Everywhere". It consumes `docs/devteam/dashboard/shell.md@1`. It depends on `kit-100-inbox-in-panel` (and through it `kit-89`, `kit-88`, `kit-87`, `kit-84`, `kit-83`); this spec and the plan are written ahead (ruling `m-20261115-203802903-supervisor`), and the build starts only once `kit-100` has merged and the supervisor has recorded `approve-plan`.

The owner settled the look on the mock `docs/devteam/project/artifacts/dashboard-cleanup/` (home): its `VIEWS.overview`, `VIEWS.goals`, the goal and Upkeep peeks and the Inbox's question card. Where this text and the mock differ, the mock is what the owner saw.

## Why

Overview today is a fleet strip, a down banner and ten loose stat tiles; Goals is a list of wide cards each carrying its own hold control, an Open link, a Strategy link and a retro badge. The owner asked for one 12-column page structure: Overview as thin-ruled sections (Status, Numbers, Goals, Needs you, Commit history) under a header with the project's status pill, Goals two across with tabs, the step bar shared by Overview, Goals and the goal peek, holds moved into the goal peek, and the next question marked with a Next chip wherever it shows. Blocked goals are outlined the way the hub outlines a blocked project, so the owner sees at a glance which goals can't move.

## How it works today (kit main `de07a84`; re-read at build, after `kit-87`…`kit-100`)

- `index.html` (6,455 lines). `render(d)` (~4626) draws everything: the ten `stats` tiles into `#stats` (done, forecast finish, workers active, blocked, median cycle, cost per ticket, spend, open questions, answer rate (14d), escaped defects), the fleet strip and the down banner on `#overview`; `#goals` holds the Strategy link, a retro badge, `upkeepCard(u)` (~2649) and one `goalCard(g, R, openQs, week)` per goal (~2687: head with state badge, priority, impact words; title link; outcome; `goalStepper`; next line; registry attestation; `holdControl`; Mark met; Open, Read the design and planner links).
- `goalState`/`goalStateOf` (~2558) give `{ key, label, tone, step, next }`; `goalProgress` (~2606) gives the Built and Met fills; `goalStepper(g, s, R)` (~2628) draws today's step bar (renamed from `goalSteps` by `kit-83`). The shell block's `goalSteps({ step, built, met })` (~1088) draws the same bar from plain data; `kit-83`'s history note says this ticket moves the callers to it.
- `holdControl(id, h, { letGo, status, restoring })` (~2640): Run, Drain, Park, Let go (confirm in place: "Confirm let go"), and Restore (parked) on a let-go goal; the click handler (~6019) posts the hold. Mark met confirms in place and posts goal status met (~6030).
- `openGoal(id)` (~3500): the goal peek: `attrs` with computed State, Why it matters (`impactBlock`, ~3491: Wrong? / Change it opens a level select and a reason, posting `correct <d> --impact n --reason …` from the owner channel, ~6326), Design, Forecast, Features, Planners, Your verdicts, Questions; then the step bar, next, hold control, Readings, the design's TL;DR, Problems, Decisions and acts, Progress, History. `kit-88` restyles every peek into properties plus section cards and tests the goal inventory item by item; this ticket builds on its result.
- Data: `/api/data` has `ooda.goals` (with `hold_view`, `impact`, `priority`, `at_target`, `measure`, `readings`, `forecast`), `ooda.roadmap`, `upkeep` (hold and chores in flight), `questions` (open, already ranked: the first is what `devteam.mjs next` names), `tickets` (`phase`, `stage`, `held`, and from `kit-84` `held_by`), `planners` (`goals`, `waiting`: what the pane is stopped at), `sensors`, `metrics` (`escaped_defects`), and from `kit-84` `upkeep_days`. `/api/hello` carries `pulse` (`state`, `activity`: commits per day, 84 days).
- The panel's Inbox tab (`kit-100`) draws today's question cards; the shell's `statusPill`, `tabBar`/`bindTabBar`, `props`, `heartbeat` and `goalSteps` are in the frozen JS block.

## What changes (all in `docs/devteam/dashboard/index.html`, outside the two shell blocks)

### 1. Overview (`#overview`)

- **Header** (`.ov-head`): the project's name (`h2`), one summary line (`.sum`: "n questions · m tickets in flight", the counts the page already has), and `statusPill(hello.pulse.state)` at the far right (`.ov-pill`, `margin-left: auto`); with no pulse yet, `statusPill('unknown')`.
- **The down banner** stays, above the sections, as today.
- **Ruled sections** (`.sec.g12`: a `.c3 .lbl` monospace label, a `.c9` body), in this order:
  - **Status:** `.rows` of `.rowline`s with a dot each: Supervisor, Workers (active of `max_active_tickets`), Planners (count, and how many are stopped), Sensors (up of total), from the data the page has today.
  - **Numbers:** twelve tiles in a `.g12 stats` grid (`.c2` each), in the mock's order: today's ten, with "escaped defects" now **Bugs merged** (hover: it counts production errors traced to a merged change or reported by the owner; hidden when the project has no production sensor, i.e. `sensors` lists none), then **Autonomy Score** and **Efficiency Score** (owner, thread `t-20261115-190001527-owner`). The two scores read their `/api/data` fields when present and show "–" when absent (see Rulings: pending `m-20261115-204531086`).
  - **Goals:** each non-closed goal (and not Upkeep) as a `.c6 .ov-goal` row: its state badge and title, then the shared step bar; a click opens the goal's peek. Every row has a 1px `--line` border; a blocked goal's row takes the blocked outline (§4) (owner, threads `t-20261115-172003292-owner`, `t-20261115-181304213-owner`). Rows side by side are the same height.
  - **Needs you:** the open questions in rank order (the Inbox's order), one `.rowline` each with a dot (red for a one-way door), the question and its kind; the first carries the Next chip. A row opens the panel's Inbox tab at that question's card (the shell's link rule for an open question).
  - **Commit history:** a mosaic of weeks, full width, no caption, from hello's `pulse.activity` (see Rulings: a year needs data, pending `m-20261115-204605295`).
- The fleet strip's place is `kit-87`'s settings area; this ticket doesn't redraw it.

### 2. The shared step bar

Overview's rows, Goals' cards and the goal peek all draw the shell's `goalSteps({ step, built, met })` (frozen block, unchanged) from one adapter, `goalStepData(g, s, R)`: `step` from `goalState`, `built` from `goalProgress().work`, `met` from `.outcome` (`{ frac, text, title }` or null), and `null` for a let-go goal (no bar, as today). The page's own `goalStepper` is removed once its callers move. Words, colours (`--series-1` done, amber current) and the status lines under Built and Met are the block's.

### 3. Goals (`#goals`)

- **Tabs:** the shell's `tabBar` with Active (running, draining, parked, drafts, plus Upkeep), Met and Let go, each with its count, bound by `bindTabBar`. The tab is the `gt` state key (`met`, `letgo`; Active is no key): selecting a tab assigns `location.hash` (`#goals?gt=met`), so Back restores the earlier tab and a reload keeps it.
- **Active:** a `.g12` of `.c6` cards (two across at 1440px; the shell's spans take them to 12 below 560px), Upkeep first, then the goals in priority order. A goal card keeps today's head (state badge, a draining badge, impact words and priority), title (opens the peek), the step bar, the next line, its links (Read the design, each planner, the registry attestation line) and Mark met (with its in-place confirm), and drops the hold control, the Open link, the Strategy link and the retro badge. A blocked goal's card takes the outline (§4).
- **Upkeep's card** shows `heartbeat(d.upkeep_days)` in place of a step bar (14 cells in the step bar's styling, today at the right, shade by the day's count, red for a failure, empty for a quiet day, a hover list of the day's items: all the block's), its hold word as a badge and the chores in flight. Its click opens Upkeep's peek.
- **Met** and **Let go:** a card per goal (badge, title, when, the reason or the measure line); its click opens the peek. Empty: "None".

### 4. Blocked goals

A pure function `goalBlock(goal, data)` (in a `goal-block` marker block, run in `vm` by the test) returns `'full'`, `'partial'` or `null`:

- A goal's **work** is its unmerged tickets (features from `ooda.roadmap`, tickets from `tickets`, stage not merged, released or superseded) and its planners (`planners` whose `goals` name it).
- A ticket **can't move** when it waits on an open question or one-way door (`held_by` set, or an open question whose `blocks` or `ticket` names it), is in phase `blocked`, or is held (`held`). A planner can't move when it is stopped at a prompt (`waiting` set).
- `'full'` when the goal has work and none of it can move; `'partial'` when some can and some can't; `null` with no work or nothing waiting. A met or let-go goal is `null`.

`.blk-full` gives the Goals card and the Overview row `border-color: color-mix(in srgb, var(--red) 45%, var(--line))`; `.blk-partial` `color-mix(in srgb, var(--amber) 55%, var(--line))` (the mock's rules, page CSS).

### 5. The goal peek and Upkeep's peek

- **Goal peek** (`#goal/<id>`, `kit-88`'s frame and inventory kept): properties first, in this order: ID (`kit-88`'s first row), Status, Hold, Priority, Why it matters (Impact), Milestones, Measured by, Opened, How it changes ("Shift+click it and say so in a thread"), then `kit-88`'s other stored and computed rows.
  - **Hold** is Run, Drain, Park and Let go (today's `holdControl`, its in-place "Confirm let go", its posts and errors); a let-go goal shows only Restore (parked); a met goal no control.
  - **Why it matters** is today's `impactBlock`: the level and reason, Wrong? / Change it opening the level and reason form, posting `correct <d> --impact n --reason …` from the owner channel. It is drawn only in a goal's peek.
- **Section cards** come from a `goal-peek` marker block: `GOAL_PEEK = { goal: [ids…], upkeep: [ids…] }` and one `GOAL_PEEK_SECTIONS[id](g, ctx)` builder per id, each returning a section card or ''. The goal list starts with the step bar and next step, then `kit-88`'s goal sections in its order (Design, Forecast, Features, Planners, Your verdicts, Questions, Readings, the design's TL;DR, Problems that threaten it, Decisions and acts, Progress); History stays last. recurring-upkeep later adds Recurring, Built-in and Proposals to `upkeep` by editing only this block.
- **Upkeep's peek** (`#goal/upkeep`): properties (ID, Status: the hold word, Hold: Run, Drain, Park with no Let go, Chores in flight, How it changes), then the `upkeep` sections: the heartbeat with each day's items listed, and the chores in flight.
- No other permanent action is added to either peek (design's action rule).

### 6. The Inbox tab and the Next chip

The panel's Inbox tab (`kit-100`) keeps today's question card unchanged, in one column the panel's width. Its first question card (`d.questions[0]`, the one `next` names) and Overview's first Needs you row carry a `.chip-next` "Next" chip (the mock's style, page CSS). Nothing else is added.

### 7. Copy

The region's obvious copy goes: Goals' heading sub-line and Strategy link, Upkeep's explanatory paragraph (its chores stay), and empty states read "None".

## Acceptance checks (the done-whens)

1. `test/dashboard-overview-goals.test.mjs` (new, headless Chrome, skipped where Chrome can't run) on a fixture project: Overview shows the header (name, summary, `statusPill` at the far right), then sections labelled Status, Numbers, Goals, Needs you, Commit history in that order, each label monospace; Numbers holds twelve tiles including Autonomy Score and Efficiency Score ("–" without their data, the value with it), and Bugs merged with its hover title, absent without a production sensor and present with one; Commit history has no caption and spans the section's body.
2. The same test: Overview, Goals and the goal peek each draw the block's `ol.steps` (the shell's `goalSteps` output for the same goal is equal on all three), the step words follow the state (Defining … Met), done steps carry `done` and the current `now` (computed colours `--series-1` and amber), Built and Met show their lines; neither shell block's bytes change (`dashboard-shell.test.mjs`'s check passes unchanged, and the test compares the blocks to main's).
3. The same test: on Goals, selecting Met then Back shows Active again, and a reload at `#goals?gt=met` shows Met.
4. The same test: Goals' tabs read Active, Met, Let go with counts; at 1440px each goal card is 6 of 12 columns (two per row, equal heights) with head, step bar, next line, links and Mark met (on an at-target goal), and no `data-hold-id`, no Open link, no Strategy link and no retro badge; the goal peek's property keys run Status, Hold, Priority, Why it matters, Milestones, Measured by, Opened, How it changes, then its sections in `GOAL_PEEK.goal`'s order; Upkeep's peek shows its properties and `GOAL_PEEK.upkeep`'s sections; Upkeep's card has a `.heartbeat` of 14 cells (from an `upkeep_days` fixture: a busy day shaded, a failed day `bad`, a quiet day empty, a hover listing the day's items, today last) and no step bar.
5. The same test: the panel's Inbox tab shows the question card as today (its parts present, one column the panel's width); its first card and Overview's first Needs you row carry the Next chip, and no other element does.
6. The same test: the goal peek's Hold is Run, Drain, Park, Let go; Let go turns to "Confirm let go" before posting; a let-go goal shows only Restore (parked); Why it matters has Wrong? / Change it, and submitting the form posts `correct` with `impact` and `reason` (the request is captured); no impact form appears on any other peek.
7. `test/dashboard-measure.test.mjs`'s `PAGES` gains `#overview`, `#goals`, `#goals?gt=met`, `#goals?gt=letgo`, a goal peek, Upkeep's peek and the panel's Inbox tab; every check passes at 1440x900, 720x800 and 390x844.
8. The final review checks the mock's inventory one by one: the ten stat tiles, the down banner, the Upkeep card, goal cards with planner links and Mark met, every part of the question card, lesson cards, the Answered list.
9. `dashboard-overview-goals.test.mjs` runs `goalBlock` in `vm` on fixtures: every unmerged ticket waiting (held_by, phase blocked, held) or every planner at a prompt gives `full`; a mix gives `partial`; nothing waiting, no work, or a met goal gives `null`. In Chrome, a fully blocked goal's card and Overview row have the muted red border and a partly blocked one the muted amber.
10. The same test: every Overview goal row has a 1px border whose colour is `--line` when not blocked and the muted red or amber when blocked.

Tests that assert today's Overview or Goals markup (`dashboard.test.mjs`, `plain-questions.test.mjs`, `ooda-*.test.mjs`, `multirepo-*.test.mjs`, `fleet-park.test.mjs`, `gateway.test.mjs`, helpers in `test/lib/`) are updated to the new markup, never loosened past what they meant to check.

## Contracts

- **Consumes** `dashboard-shell@1`: `goalSteps`, `heartbeat`, `statusPill`, `tabBar`/`bindTabBar`, `props`, `.g12`/`.c6`, `.sec`/`.lbl`/`.rows`/`.rowline`/`.dot`, `.ov-head`, the `gt` state key and the router's hash rules. Changes neither block.
- **Provides** (inside the page, not a versioned contract): the `goal-peek` marker block (`GOAL_PEEK`, `GOAL_PEEK_SECTIONS`) that recurring-upkeep edits; `goalBlock` in its marker block.

## Edge cases

- No goals: Overview's Goals section and Goals' Active tab say "None"; Upkeep's card still shows.
- No open questions: Needs you says "None"; no Next chip anywhere.
- A held goal (drain/park): its badge says so; its card has no hold control, its peek does.
- A goal at target: Mark met on its card, confirm in place; the error line on failure.
- `upkeep_days` missing (an older server) or shorter than 14: the heartbeat draws what it gets; missing gives no strip.
- A ticket held by an answered question (`held_by` null) is not waiting on the owner.
- `hello` not yet answered: the pill is `statusPill('unknown')`; the mosaic is empty.
- At 390px, the 12 tiles and the goal rows reflow by the shell's spans; nothing sticks out.

## Out of scope

- Board, Progress, Library, Autonomy pages, the hub (other tickets).
- Reordering goals (`kit-234`, after this).
- New `/api/data` fields (except as ruled on the two pending questions).
- Either shell block.

## Rulings

- `m-20261115-203802903-supervisor`: plan ahead; build only after deps merge and `approve-plan`; run only touched test files at `--test-concurrency=2`; briefs carry lessons k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule.
- Pending `m-20261115-204531086-kit-90-overview-goals` (score tiles without kit-98/kit-173 data): spec assumes "–" when absent.
- Pending `m-20261115-204605295-kit-90-overview-goals` (a year of commit weeks needs a data change): spec assumes the 84-day pulse until ruled.
