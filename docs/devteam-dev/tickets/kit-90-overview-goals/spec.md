# kit-90: Overview and Goals

Ticket `kit-90-overview-goals` (kind `build`, size M, risk normal; depends on `kit-100`, `kit-98`, `kit-173` and `kit-242`), feature `dashboard-cleanup`, story `DCL-S5`, design `project/designs/a-cleaner-more-consistent-dashboard.md` (home), sections "Overview and Goals", "The side peek" (goal entry, action rule) and "Everywhere". It consumes `docs/devteam/dashboard/shell.md@1`. It depends on `kit-100-inbox-in-panel` (and through it `kit-89`, `kit-88`, `kit-87`, `kit-84`, `kit-83`); this spec and the plan are written ahead (ruling `m-20261115-203802903-supervisor`), and the build starts only once `kit-100` has merged and the supervisor has recorded `approve-plan`.

The owner settled the look on the mock `docs/devteam/project/artifacts/dashboard-cleanup/` (home): its `VIEWS.overview`, `VIEWS.goals`, the goal and Upkeep peeks and the Inbox's question card. Where this text and the mock differ, the mock is what the owner saw.

## Why

Overview today is a fleet strip, a down banner and ten loose stat tiles; Goals is a list of wide cards each carrying its own hold control, an Open link, a Strategy link and a retro badge. The owner asked for one 12-column page structure: Overview as thin-ruled sections (Status, Numbers, Autonomy, Goals, Needs you, Commit history) under a header with the project's status pill, Goals two across with tabs, the step bar shared by Overview, Goals and the goal peek, holds moved into the goal peek, and the next question marked with a Next chip wherever it shows. Blocked goals are outlined the way the hub outlines a blocked project, so the owner sees at a glance which goals can't move.

## How it works today (kit main `de07a84`; re-read at build, after `kit-87`…`kit-100`)

- `index.html` (6,455 lines). `render(d)` (~4626) draws everything: the ten `stats` tiles into `#stats` (done, forecast finish, workers active, blocked, median cycle, cost per ticket, spend, open questions, answer rate (14d), escaped defects), the fleet strip and the down banner on `#overview`; `#goals` holds the Strategy link, a retro badge, `upkeepCard(u)` (~2649) and one `goalCard(g, R, openQs, week)` per goal (~2687: head with state badge, priority, impact words; title link; outcome; `goalStepper`; next line; registry attestation; `holdControl`; Mark met; Open, Read the design and planner links).
- `goalState`/`goalStateOf` (~2558) give `{ key, label, tone, step, next }`; `goalProgress` (~2606) gives the Built and Met fills; `goalStepper(g, s, R)` (~2628) draws today's step bar (renamed from `goalSteps` by `kit-83`). The shell block's `goalSteps({ step, built, met })` (~1088) draws the same bar from plain data; `kit-83`'s history note says this ticket moves the callers to it.
- `holdControl(id, h, { letGo, status, restoring })` (~2640): Run, Drain, Park, Let go (confirm in place: "Confirm let go"), and Restore (parked) on a let-go goal; the click handler (~6019) posts the hold. Mark met confirms in place and posts goal status met (~6030).
- `openGoal(id)` (~3500): the goal peek: `attrs` with computed State, Why it matters (`impactBlock`, ~3491: Wrong? / Change it opens a level select and a reason, posting `correct <d> --impact n --reason …` from the owner channel, ~6326), Design, Forecast, Features, Planners, Your verdicts, Questions; then the step bar, next, hold control, Readings, the design's TL;DR, Problems, Decisions and acts, Progress, History. `kit-88` restyles every peek into properties plus section cards and tests the goal inventory item by item; this ticket builds on its result.
- Data: `/api/data` has `ooda.goals` (with `hold_view`, `impact`, `priority`, `at_target`, `measure`, `readings`, `forecast`), `ooda.roadmap`, `upkeep` (hold and chores in flight), `questions` (open, already ranked: the first is what `devteam.mjs next` names), `tickets` (`phase`, `stage`, `held`, and from `kit-84` `held_by`), `planners` (`goals`, `waiting`: what the pane is stopped at), `sensors`, `metrics` (`escaped_defects`), and from `kit-84` `upkeep_days`. `/api/hello` carries `pulse` (`state`, `activity`: commits per day, 84 days).
- The panel's Inbox tab (`kit-100`) draws today's question cards; the shell's `statusPill`, `tabBar`/`bindTabBar`, `props`, `heartbeat` and `goalSteps` are in the frozen JS block.

## What changes (all in `docs/devteam/dashboard/index.html`, outside the two shell blocks)

### 1. Overview (`#overview`)

- **Header** (`.ov-head`): the project's name (`h2`), one summary line (`.sum`: "n questions · m tickets in flight", the counts the page already has), and `statusPill(hello.pulse.state)` at the far right (`.ov-pill`, `margin-left: auto`). The page fetches `/api/hello` (as the artifact viewer does today) on load and with each 10-second redraw; until it answers, or when it fails, the pill is `statusPill('unknown')` (S3).
- **The down banner** stays, above the sections, as today.
- **Ruled sections** (`.sec.g12`: a `.c3 .lbl` monospace label, a `.c9` body), in this order:
  - **Status:** `.rows` of `.rowline`s with a dot each: Supervisor (from `/api/threads`' `supervisor.question`, which the page already polls and `askSet` keeps: red "stopped at a prompt" for a menu or dialog, amber "at a usage limit" for `kind: 'limit'`, else green with hello's `pulse.last_activity` as "last moved … ago"; S3, S13), Workers (active of `max_active_tickets`), Planners (count, and how many are stopped), Sensors (up of total).
  - **Numbers:** today's ten tiles in a `.g12 stats` grid (`.c2` each), in the mock's `STATS` order: done, forecast finish, workers active, blocked, median cycle, cost per ticket, spend, open questions, answer rate (14d), **Bugs merged** (today's "escaped defects"; with an info icon and the mock's hover: "A production error traced to a merged change, or one you reported. Shown once the project has a production sensor."). Bugs merged is hidden without a production sensor (`sensors` lists none), leaving nine. No score is a Numbers tile (owner, thread `t-20261115-232829027`, reopened; done-when changed in `m-20261115-234500335-supervisor`).
  - **Autonomy:** one row of four `.c3 stat` tiles in this order: **Autonomy Score**, **Trust Score**, **Efficiency Score**, **Awareness Score** (owner, threads `t-20261115-232829027`, `t-20261115-233023839`), each its label, its % and a 12-week line (the mock's `spark`: an `svg.sparkline` `viewBox="0 0 80 18"`, one `polyline` in `--series-1`, `aria-label="<label>, the last 12 weeks"`). They read `/api/data`'s `autonomy_score`, `autonomy` (the Trust Score, renamed from the Autonomy Score), `efficiency` and `awareness`, each field read through one accessor, `scoreOf(x)`, in its own `score-of` marker block. The shape is the one `kit-98` (`autonomy`) and `kit-173` (`efficiency`) serve and `kit-242` (`awareness`, `autonomy_score`) builds on their 12 weeks: `x.score.this_week` is the % (0–100, rounded, shown as `n%`), and `x.weeks` holds 12 records, oldest first, the last this week, each with its `score` (null in a week with no score). The line is those 12 `score`s: one point per week that has a score, at that week's place, so a gap stays a gap. A field absent or null, or a null `score.this_week`, shows "–"; a line needs two scored weeks or more. This ticket waits on `kit-98`, `kit-173` and `kit-242` (plan change graph-20, `m-20261116-000030161-supervisor`), so at build `scoreOf` is checked against their merged code and fixtures, and if one names a field otherwise only `scoreOf` changes. Autonomy Score carries the hover "The mean of the Trust, Efficiency and Awareness Scores, weighted equally; – until all three exist" and an info icon; the page shows the served `autonomy_score` and doesn't compute the mean itself.
  - **Goals:** every active goal (running, draining, parked, drafts; not Upkeep, met or let go), my call over the mock's first four, since its four were sample data and a hidden goal is one the owner can't see (S7): a `.c6 .ov-goal` row each, its state badge and title, then the shared step bar (equal to Goals' and the peek's for the same goal); a click opens the goal's peek. Every row has a 1px `--line` border; a blocked goal's row takes the blocked outline (§4) (owner, threads `t-20261115-172003292-owner`, `t-20261115-181304213-owner`). Rows side by side are the same height. None: "None".
  - **Needs you:** the open questions in rank order (the Inbox's order), one `.rowline` each with a dot (red for a one-way door), the question and its kind; the first carries the Next chip. A row opens the panel's Inbox tab at that question's card (the shell's link rule for an open question).
  - **Commit history:** a mosaic of weeks, full width, no caption, from hello's `pulse.activity`: today its 84 days, 12 weeks (ruling `m-20261115-204822283-supervisor`; a year of weeks comes later as its own data change). Columns are weeks (`repeat(n, 1fr)`, n from the data's length, so a year later needs no page change), rows the 7 days, each cell 10px tall, so 12 weeks stretch into wide cells rather than tall ones (S1).
- The fleet strip's place is `kit-87`'s settings area; this ticket doesn't redraw it.

### 2. The shared step bar

Overview's rows, Goals' cards and the goal peek all draw the shell's `goalSteps({ step, built, met })` (frozen block, unchanged) from one adapter, `goalStepData(g, s, R)`: `step` from `goalState`, `built` from `goalProgress().work`, `met` from `.outcome` (`{ frac, text, title }` or null), and `null` for a let-go goal (no bar, as today). The page's own `goalStepper` is removed once its callers move. Words, colours (`--series-1` done, amber current) and the status lines under Built and Met are the block's.

### 3. Goals (`#goals`)

- **Tabs:** the shell's `tabBar` with Active (running, draining, parked, drafts, plus Upkeep), Met and Let go, each with its count, bound by `bindTabBar`. The tab is the `gt` state key (`met`, `letgo`; Active is no key): selecting a tab assigns `location.hash` (`#goals?gt=met`), so Back restores the earlier tab and a reload keeps it.
- **Active:** a `.g12` of `.c6` cards (two across at 1440px; the shell's spans take them to 12 below 560px), Upkeep first, then the goals in priority order. A goal card keeps today's head (state badge, a draining badge, impact words and priority), title (opens the peek), the step bar, the next line, its links (Read the design, each planner, the registry attestation line) and Mark met (with its in-place confirm), and drops the hold control, the Open link, the Strategy link and the retro badge. A blocked goal's card takes the outline (§4). Under the cards, today's `#unassigned` line (features with no goal) stays; with no goals, today's empty state with its link to the open goal-definition question stays (S9).
- **Upkeep's card** shows `heartbeat(heartbeatDays(d.upkeep_days))` in place of a step bar. `kit-84` sends each day as `{ starts_at, items: [{ kind, ref, words, at }], failed }`; the page's adapter `heartbeatDays(days)` gives the block's `{ day: starts_at.slice(0, 10), items: items.map((i) => i.words), failed }` (S15). The strip: 14 cells in the step bar's styling, today at the right, shade by the day's count, red for a failure, empty for a quiet day, a hover list of the day's items, all the block's. The card also shows its hold word as a badge with the mock's head extra ("always on", or "the fleet is parked" / "draining"), and the chores in flight; no hold control. Its click opens Upkeep's peek (S4, S12).
- **Met** and **Let go:** a card per goal (badge, title, when, the reason or the measure line); its click opens the peek. Empty: "None".

### 4. Blocked goals

A pure function `goalBlock(goal, data)` (in a `goal-block` marker block, run in `vm` by the test) returns `'full'`, `'partial'` or `null`:

- A goal's **work** is its unmerged tickets (features from `ooda.roadmap`, tickets from `tickets`, stage not merged, released or superseded) and its planners (`planners` whose `goals` name it).
- A ticket **can't move** when it waits on an open question or one-way door with no default: `held_by` names a question that is open in `questions` and has no `default` (`kit-84` sets `held_by` for a question with a default too, which the hub doesn't count), or such a question's `blocks` or `ticket` names it (S16), is in phase `blocked`, or is held (`held`); and, as the hub's `helloPulse` counts it, so does every ticket that depends on one that can't, however far down (S2). A planner can't move when it is stopped at a prompt or dialog (`waiting` set with a kind other than `limit`: a usage limit lifts by itself).
- A goal the owner parked or let go waits by choice, as the hub says: `null`, whatever its work (S2).
- `'full'` when the goal has work and none of it can move; `'partial'` when some can and some can't; `null` with no work or nothing waiting. A met or let-go goal is `null`.

`.blk-full` gives the Goals card and the Overview row `border-color: color-mix(in srgb, var(--red) 45%, var(--line))`; `.blk-partial` `color-mix(in srgb, var(--amber) 55%, var(--line))` (the mock's rules, page CSS).

### 5. The goal peek and Upkeep's peek

- **Goal peek** (`#goal/<id>`, `kit-88`'s frame and inventory kept): properties first: ID (`kit-88`'s first row), then, contiguous and in the done-when's order, Status, Hold, Priority, Why it matters (Impact), Milestones, Measured by, Opened, How it changes (`kit-88`'s own `howItChanges` row, its Start a thread button kept, only moved into this order), then `kit-88`'s other stored rows, then its Computed rows. If this restructure breaks anything `kit-88`'s goal-peek tests assert in a file outside these touches (`test/dashboard-peek.test.mjs`), that is a design-change message at build, not an edit (S8, S14, S18).
  - **Hold** is Run, Drain, Park and Let go (today's `holdControl`, its in-place "Confirm let go", its posts and errors); the confirm lives in page memory, so it survives the 10-second redraw; the fleet hint ("use the strip at the top") goes, since the strip moved to settings (S12). A let-go goal shows only Restore (parked); a met goal no control.
  - **Why it matters** is today's `impactBlock`: the level and reason, Wrong? / Change it opening the level and reason form, posting `correct <d> --impact n --reason …` from the owner channel. It is drawn only in a goal's peek.
- **Section cards** come from a `goal-peek` marker block: `GOAL_PEEK = { goal: [ids…], upkeep: [ids…] }` and one `GOAL_PEEK_SECTIONS[id](g, ctx)` builder per id, each returning a section card or ''. The goal list starts with the step bar and next step, then `kit-88`'s goal sections in its order (Design, Forecast, Features, Planners, Your verdicts, Questions, Readings, the design's TL;DR, Problems that threaten it, Decisions and acts, Progress); History stays last. recurring-upkeep later adds Recurring, Built-in and Proposals to `upkeep` by editing only this block.
- **Upkeep's peek** (`#goal/upkeep`): properties ID, Status (the hold word), Hold (Run, Drain, Park; no Let go), Held because (`u.reason`, shown when held), What it covers ("Chores, CI fixes, research, retros, kit syncs and the improvement loop's trials and proposals", today's card paragraph moved here), Chores in flight, How it changes (`kit-88`'s `howItChanges` for Upkeep); then the `upkeep` sections: the heartbeat with each day's items listed, and the chores in flight (S4).
- No other permanent action is added to either peek (design's action rule).

### 6. The Inbox tab and the Next chip

The panel's Inbox tab (`kit-100`) keeps today's question card unchanged, in one column the panel's width. The chip goes on whatever card stands for `d.questions[0]` (the one `next` names), be it a question, review or secrets card; the build checks that the tab draws cards in `d.questions` order (S11). That card and Overview's first Needs you row carry a `.chip-next` "Next" chip (the mock's style, page CSS). Nothing else is added.

### 7. Copy

The region's obvious copy goes: Goals' heading sub-line and Strategy link, Upkeep's explanatory paragraph (its chores stay), and empty states read "None".

## Acceptance checks (the done-whens)

1. `test/dashboard-overview-goals.test.mjs` (new, headless Chrome, skipped where Chrome can't run) on a fixture project: Overview shows the header (name, summary, `statusPill` at the far right; `unknown` before hello answers), then sections labelled Status, Numbers, Autonomy, Goals, Needs you, Commit history in that order, each label monospace; Numbers runs in the mock's order, nine tiles without a production sensor (no Bugs merged) and ten with one (Bugs merged last, with its hover title), and no score among them; the Autonomy row reads Autonomy Score, Trust Score, Efficiency Score, Awareness Score in that order, each "–" with no line when the four fields are patched to null, and `n%` with a 12-point `polyline` drawn from its own field's weeks when `autonomy_score`, `autonomy`, `efficiency` and `awareness` are patched in the data tickets' shape (Autonomy Score with its hover); a field with null weeks draws points only for the scored weeks; Commit history has no caption, spans the section's body, and has one column per week of `pulse.activity` (12 for the 84 days).
2. The same test: Overview, Goals and the goal peek each draw the block's `ol.steps` (the shell's `goalSteps` output for the same goal is equal on all three, for goals in four states: a draft being defined, one waiting on approval, one being built, one at its target), the step words follow the state (Defining … Met), done steps carry `done` and the current `now` (computed colours `--series-1` and amber), Built and Met show their lines; neither shell block's bytes change (`dashboard-shell.test.mjs`'s check passes unchanged, and the test compares `index.html`'s two blocks byte for byte with `hub.html`'s, which this ticket doesn't touch; S10).
3. The same test: on Goals, selecting Met then Back shows Active again, and a reload at `#goals?gt=met` shows Met.
4. The same test (Upkeep's card has no `data-hold-id`; its peek shows Held because when held and What it covers): Goals' tabs read Active, Met, Let go with counts; at 1440px each goal card is 6 of 12 columns (two per row, equal heights) with head, step bar, next line, links and Mark met (on an at-target goal), and no `data-hold-id`, no Open link, no Strategy link and no retro badge; the goal peek's property keys run Status, Hold, Priority, Why it matters, Milestones, Measured by, Opened, How it changes, then its sections in `GOAL_PEEK.goal`'s order; Upkeep's peek shows its properties and `GOAL_PEEK.upkeep`'s sections; Upkeep's card has a `.heartbeat` of 14 cells (from an `upkeep_days` fixture: a busy day shaded, a failed day `bad`, a quiet day empty, a hover listing the day's items, today last) and no step bar.
5. The same test: the panel's Inbox tab shows the question card as today (its parts present, one column the panel's width); its first card and Overview's first Needs you row carry the Next chip, and no other element does.
6. The same test: the goal peek's Hold is Run, Drain, Park, Let go; Let go turns to "Confirm let go" before posting; a let-go goal shows only Restore (parked); Why it matters has Wrong? / Change it, and submitting the form posts `correct` with `impact` and `reason` (the request is captured); no impact form appears on any other peek.
7. `test/dashboard-measure.test.mjs`'s `PAGES` gains `#overview`, `#goals`, `#goals?gt=met`, `#goals?gt=letgo`, a goal peek, Upkeep's peek and the panel's Inbox tab; every check passes at 1440x900, 720x800 and 390x844.
8. The final review checks the mock's inventory one by one: the ten stat tiles, the down banner, the Upkeep card, goal cards with planner links and Mark met, every part of the question card, lesson cards, the Answered list.
9. `dashboard-overview-goals.test.mjs` runs `goalBlock` in `vm` on fixtures: every unmerged ticket waiting (held_by, an open question's `blocks`, phase blocked, held) gives `full`; one waiting ticket that every other ticket depends on (directly or two levels down) gives `full`; every planner at a prompt gives `full`, a planner at a usage limit doesn't count; a mix gives `partial`; nothing waiting, no work, a met or let-go goal, or a goal the owner parked gives `null`; a question blocking another goal's ticket doesn't mark this one. In Chrome, a fully blocked goal's card and Overview row have the muted red border and a partly blocked one the muted amber.
10. The same test: every Overview goal row has a 1px border whose colour is `--line` when not blocked and the muted red or amber when blocked, and rows side by side have equal heights.

Tests that assert today's Overview or Goals markup (`dashboard.test.mjs`, `plain-questions.test.mjs`, `ooda-*.test.mjs`, `multirepo-*.test.mjs`, `fleet-park.test.mjs`, `gateway.test.mjs`, helpers in `test/lib/`) are updated to the new markup, never loosened past what they meant to check.

## Contracts

- **Consumes** `dashboard-shell@1`: `goalSteps`, `heartbeat`, `statusPill`, `tabBar`/`bindTabBar`, `props`, `.g12`/`.c6`, `.sec`/`.lbl`/`.rows`/`.rowline`/`.dot`, `.ov-head`, the `gt` state key and the router's hash rules. Changes neither block.
- **Provides** (inside the page, not a versioned contract): the `goal-peek` marker block (`GOAL_PEEK`, `GOAL_PEEK_SECTIONS`) that recurring-upkeep edits; `goalBlock` in its marker block; `scoreOf` in the `score-of` marker block.

## Edge cases

- No goals: Overview's Goals section and Goals' Active tab say "None"; Upkeep's card still shows.
- No open questions: Needs you says "None"; no Next chip anywhere.
- A held goal (drain/park): its badge says so; its card has no hold control, its peek does.
- A goal at target: Mark met on its card, confirm in place; the error line on failure.
- `upkeep_days` missing (an older server) or shorter than 14: the heartbeat draws what it gets; missing gives no strip.
- A ticket held by an answered question (`held_by` null) is not waiting on the owner.
- `hello` not yet answered: the pill is `statusPill('unknown')`; the mosaic is empty.
- A score served with a % and fewer than two scored weeks: the % shows, no line. Null weeks inside the 12 leave gaps (no point), not zeros.
- At 390px, the ten tiles, the Autonomy row and the goal rows reflow by the shell's spans; nothing sticks out.

## Out of scope

- Board, Progress, Library, Autonomy pages, the hub (other tickets).
- Reordering goals (`kit-234`, after this).
- New `/api/data` or hello fields (the four scores' data is the score tickets'), and a year of commit weeks (ruling `m-20261115-204822283-supervisor`).
- Either shell block.

## Rulings

- `m-20261115-203802903-supervisor`: plan ahead; build only after deps merge and `approve-plan`; run only touched test files at `--test-concurrency=2`; briefs carry lessons k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule.
- Asked `m-20261115-210051001-kit-90-overview-goals`: amend done-when 1's "a year of weeks" to the ruled 84 days (S17).
- `m-20261115-204822283-supervisor` (answering `m-20261115-204531086` and `m-20261115-204605295`): (1) both score tiles read `/api/data`'s fields when present and show "–" when absent, tested both ways, with no dependency on `kit-98` or `kit-173`; (2) Commit history draws the 84 days at full width now; `devteam.mjs` stays out of the touches, and a year of weeks comes later as its own small data change.
- `m-20261115-210347780-supervisor`: done-when 1 now says the weeks hello's `pulse.activity` holds (84 days today), full width, no caption.
- `m-20261115-210557189-supervisor`: approve-spec and approve-plan at 915c3bd; build once `kit-100` merges.
- `m-20261115-214239909-supervisor`: review rounds are capped; after a second round, Minor findings are fixed and disposed with no further pass; a third pass only confirms a Critical or Important fix.
- `m-20261115-234500335-supervisor`: done-when changed (owner's mock threads): Numbers back to ten tiles, then a new Autonomy row (Autonomy, Trust, Efficiency, Awareness, each % with a 12-week line, "–" when not served); amend spec and plan, one combined re-review of the delta, then re-approval.
- `m-20261115-235051446-supervisor`: re-approved spec and plan at 117800a.
- `m-20261116-000030161-supervisor` (plan change graph-20): kit-90 also waits on `kit-242` and draws the Autonomy row from its data (and `kit-98`'s and `kit-173`'s); done-when 1 puts Bugs merged back inside Numbers; one delta review, then re-approval.
