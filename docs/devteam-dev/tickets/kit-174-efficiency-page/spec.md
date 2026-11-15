# kit-174: the Efficiency page beside Trust

Ticket `kit-174-efficiency-page` (kind build, size M, risk normal), feature `dashboard-cleanup`, story DCL-S13, design `project/designs/a-cleaner-more-consistent-dashboard.md` (home), section Autonomy pages › Efficiency. Consumes `docs/devteam/dashboard/shell.md@1`. Depends on `kit-99-autonomy-suggestions` (Trust's Autonomy Score card and its Suggestions list, the `suggestion:<id>` thread subject) and `kit-173-efficiency-data` (`/api/data` `efficiency`). Written ahead of both (ruling `m-20261115-203712796-supervisor`): build starts only once both have merged and `approve-plan` is recorded.

## Why

The owner can't see whether the fleet spends tokens and time well, or what would lower spend without lowering quality: Health lists raw hours, dollars and tokens, and the spend findings scroll by (design, Reverse chain, "(owner) Efficiency"). `kit-173` computes one Efficiency Score a week (spend, time and rework against the best of the last 12 weeks, quality held) plus where the spend goes, the waste and ranked suggestions. This ticket draws it as its own page, beside Trust, laid out as Trust's Autonomy Score is, and moves Health's four spend cards onto it.

## The reference

The mock at main, `project/artifacts/dashboard-cleanup/index.html` (home): `efficiencyScore()` and its helpers (`phaseBars`, `effBars`, the Waste rows, `suggestionsList(EFF_SUGG)`), the nav entry, and Notes' inventory lines for Health and Efficiency. The owner settled the layout on thread `t-20261115-180708537-owner` (outcome: "Efficiency now follows Trust: Score, Where it goes, Waste, Suggestions (no OODA headings; trials stay on Self Improvement)"). Where this spec and the mock differ in wording, the mock wins; where the mock draws fake numbers, the page draws the data's. (Thread `t-20261115-190001527-owner`, cited beside it in the supervisor's act, is the Overview's Autonomy and Efficiency Score tiles: `kit-90`'s, not this page's.)

## How it works at kit main today (`de07a84`), and what the dependencies change

- Health (`<section id="health">`, index.html ~899) holds Findings, Set aside, Hours by phase (`#phase-time`, `bars(m.phase_hours)`), USD by phase (`#phase-cost`), USD by model (`#model-cost`, from `m.cost.by_model[k].usd`), Tokens (`#token-note`: "Measured from the agents' own session logs. Input · output · cache reads · cache writes", the unpriced models in red, or "Nothing measured: spend shows only what agents reported."), Checks before merge (`#gates`) and the flaky and slowest test lists (`#test-lists`); drawn in `render()` ~4716–4752. `#health` already redirects to `#sensors?st=fleet` in `SHELL_ROUTES`.
- `kit-87` makes each nav item a page (`registerPage`), `kit-93` makes Trust the Autonomy Score card (ruled `.sec g12` sections, `c3 lbl` label column, `c9` body; charts drawn at the width they get) and Sensors › Fleet today's Health, `kit-99` adds the Suggestions section and the click-to-thread behaviour on `{"kind":"item","ref":"suggestion:<id>"}` (opening the open thread if there is one, via `kit-97`). This ticket reuses those pieces as they land; it doesn't re-implement them.
- `T_HOME` (~4789) and `T_WHERE` (~4913) map an item ref's prefix (before `:`) to a page and its words. After `kit-99`, `suggestion` maps to Trust.

## The data this page reads

From `kit-173`'s spec (its "The shape: `efficiency`", at `7f41c90` on its branch); field names are rechecked against its merged code when the plan is updated before build, and a mismatch is fixed in the plan, never by changing `kit-173`:

- `efficiency.weeks[12]`, oldest first, the last this week: `starts_at`, `tickets`, `points`, `usd_per_point` (null with no tickets), `hours_per_point` (null with none), `first_pass`, `first_passes`, `cache_read_share` (null with no spend items), `escaped_defects`, `usd_by_phase`, `tokens_by_phase` (`{ <phase>: { input, output, cache_read, cache_write } }`), `score` (0..100, null under 3 tickets), `parts` (`{ spend, time, rework }` or null).
- `efficiency.best` (`{ usd_per_point, hours_per_point }`, null when no week is scored), `efficiency.score` (`{ this_week, last_week }`), `efficiency.parts` (this week's, or null).
- `efficiency.observe`: `phase_hours`, `phase_usd`, `by_model`, `tokens`, `tokens_by_phase`.
- `efficiency.waste[]`: `{ id, kind, subject, detail }`; `id` is the newest metrics observation recording the finding, **null until one is logged**.
- `efficiency.suggestions[]` (at most 5, ranked): `{ id, kind, what, evidence, effect, usd, per }`; `kind` is one of `review-depth`, `smaller-model`, `cache`, `costly-ticket`, `tighter-specs`; `what`, `evidence`, `effect` are already plain sentences.
- `efficiency.trials` is not drawn (trials stay on Self Improvement).
- From `metrics` (not `efficiency`): `cost.source` and `cost.unpriced_models` for the source line.

The page computes no score, best or ratio itself; it formats what it is given.

## What changes (all in `docs/devteam/dashboard/index.html`, plus tests)

1. **The page.** `registerPage({ id: 'efficiency', title: 'Efficiency', group: 'Autonomy', icon: 'zap', count, render })`, placed so the nav's Autonomy group reads Trust, Efficiency, then the rest as they are. `'efficiency'` joins `SHELL_ROUTES.pages` (and `T_SECTIONS`) right after `trust`. The nav count is `efficiency.score.this_week` as `NN%` (the mock's `72%`), blank when null or when `efficiency` is missing.
2. **One card**, `Efficiency Score` (card head as Trust's, icon `gauge`, right label "this week"), in ruled sections, each a `c3` label and a `c9` body, as Trust's card is:
   - **Score.**
     - This week's score big and "last week NN%" beside it, each "–" when null; the line "spend, time and rework against the best of the last 12 weeks, with quality held".
     - Three stats from `efficiency.parts` (each "–" when null): spend, time, rework as percentages, each with its ratio in words: spend "best $B ÷ this week $T per point" (from `best.usd_per_point` and `weeks[11].usd_per_point`), time "best B ÷ this week T hours per point", rework "reviews passed the first time". When this week has an escaped defect, the spend and time lines read "held down: an escaped defect this week" instead of the ratio (the part is then another week's value, so the ratio would disagree with it). When a number in a ratio is null the line reads "–".
     - The rework stat and the "reviews passed the first time" mini stat carry a `title`: "first passes of each spec, plan, final and task review" (ruling `m-20261115-204118085-supervisor`: first-pass counts each task review, and the page's tooltip says so).
     - The score's 12-week line, drawn with Trust's line helper or one like it: x one slot per week, oldest first, this week last and marked, last week marked; y a fixed 0 to 100 axis (scores below 50 happen: a week with an escaped defect can score 33 or less); a null week is a gap (no point, the line broken around it).
     - Six mini stats, three per row, each its number and a sparkline over the 12 weeks: $ per merged point ("$T · best $B"), hours per merged point ("T · best B"), reviews passed the first time (%), cache reads of input tokens (`cache_read_share`, %), escaped defects ("N (target 0)"), merged points. Every sparkline treats a null as a gap; a number that is null reads "–".
     - "Spend by phase, each week": one stacked bar a week, one segment per key of the weeks' `usd_by_phase` (the union of keys, ordered by total spend over the 12 weeks, largest at the bottom; ties by key), colours from the series palette in that order (cycling past its end), each segment's `<title>` "<this week | last week | N weeks ago>: <phase> $x of $total"; a week with no spend is an empty slot; a legend with this week's dollars per key. Labels are the kit's own phase keys as they come.
     - Weeks are named relative to now ("this week", "last week", "N weeks ago"), as the mock does; `starts_at` is not shown.
   - **Where it goes.** Five bar blocks, two across (`c6`), each a `props-h` heading with an icon, read from `efficiency.observe` when present and otherwise from `metrics` (the same fields, `phase_hours`, `phase_usd`, `cost.by_model`, `cost.tokens`), so nothing Fleet showed today disappears on a server without `efficiency`: Tokens by phase (millions; a phase's total of its four token counts; only from `observe.tokens_by_phase`, "None" without it), Hours by phase, USD by phase, USD by model (`[k].usd`), Tokens (millions: cache read, input, cache write, output). Each is labelled by the kit's own keys and sorted largest first; empty data reads "None". Under them, one line on where the figures come from (the gap audit's item; Notes: "Efficiency (kit-174): where the spend figures come from, under Where it goes"), from `metrics.cost`: "Measured from the agents' own session logs" when `cost.source` is `measured`, else "Nothing measured: spend shows only what agents reported", then "· Unpriced: <models>" when `cost.unpriced_models` has any (in the error colour, as today). The session and settings-priced counts the mock shows are not in the data and are not drawn.
   - **Waste.** `efficiency.waste` as `.rows` of `.rowline` lines: an amber dot, the finding's `detail` (linkified as Fleet's findings are), and on the right its kind in plain words from one map (`cost-hotspot` "cost hotspot", `costly-ticket` "costly ticket", `low-cache-hit` "low cache hits", `cost-per-point-rising` "cost per point rising", `unpriced-model` "unpriced model"; an unknown kind through the page's `words()`, never the raw id). No separate dollar figure: `waste` carries none, and the detail already says its dollars where the finding has them (the mock's "$254" column is dropped). A line with an `id` is focusable (`tabindex=0`, role link) and opens `#observation/<id>`'s peek on a click or Enter. A line whose `id` is null is plain text: not focusable, no link, and a click or Enter opens nothing. Empty: "None".
   - **Suggestions.** `efficiency.suggestions`, numbered, drawn by kit-99's suggestions list. The title comes from a words map for the five kinds, the mock's titles: `review-depth` "Fit review depth to the ticket", `smaller-model` "Use a smaller model where it fits", `cache` "Keep the prompt cache", `costly-ticket` "Find where a costly ticket's spend went", `tighter-specs` "Write tighter specs"; an unknown kind gets "Suggestion", never the id. Under it `what`, the evidence and the estimated effect (as sent). No buttons. A click or Enter on one starts a thread on `{"kind":"item","ref":"suggestion:<id>"}`, or opens the open thread on it if one exists, exactly as Trust's do; nothing else is written. Empty: "None this week".
3. **Where an `eff-` suggestion lives.** `T_HOME` and `T_WHERE` are keyed by prefix, so a lookup helper (the one `kit-99` uses, if it adds one, else a new `tHomeOf(ref)` / `tWhereOf(ref)` used everywhere the two maps are read for an item ref) places `suggestion:eff-…` on `efficiency` / "Efficiency" and every other `suggestion:` on Trust. The thread's floating card and pin find the suggestion on the Efficiency page; `tWhere` reads "Efficiency".
4. **Sensors › Fleet loses the four spend cards** (Hours by phase, USD by phase, USD by model, Tokens) and their render lines; Findings, Set aside, Checks before merge and the flaky and slowest test lists stay, unchanged.
5. **Charts at the width they get.** The score line, sparklines and phase bars are drawn at their container's width on render and redrawn on resize, as Trust's are, so mono labels keep one size.
6. **Running text** stays within `--measure`; the page passes every check in `test/lib/measure.mjs`.

## Contracts

- Consumes `shell.md@1`: `registerPage`, the layout block's `.g12`, `.sec`, `.rows`, the measure check. Adding a page id is the router table's job (outside the frozen blocks), so no block changes. shell.md §5's prose list of page ids won't name `efficiency`; shell.md is outside this ticket's touches, so the review request asks the supervisor whether that sentence needs a note (recommendation: no version bump; the list is the router table's).
- Consumes `/api/data` `efficiency` as above (`kit-173`), and `metrics.cost` as today.
- Consumes kit-99's suggestion list and click-to-thread, and kit-97's one-thread-per-subject.

## Acceptance checks (the done-whens)

The page tests rewrite `/api/data` in the page (an init script wrapping `fetch`, as `dashboard-answers.test.mjs` does) to carry a fixture `efficiency` with known values: 12 weeks, one with a null score and null `usd_per_point`/`hours_per_point`/`cache_read_share`, this week with an escaped defect scoring under 50, last week scored, four phase keys with one missing in some weeks, two waste items (one with an `id`, one with `id: null`), and three suggestions of known kinds plus one of an unknown kind.

1. `test/dashboard-efficiency.test.mjs` passes in CI (headless Chrome):
   - the nav's Autonomy group has Efficiency right after Trust, its count this week's score as `NN%`;
   - `#efficiency` is one card, Efficiency Score, with sections Score, Where it goes, Waste, Suggestions in that order, no Observe, Orient, Decide or Act heading and no trials table;
   - Score shows this and last week's score; spend, time and rework, this week's spend and time reading "held down…" (the defect week) and, on a second fixture without the defect, the ratio words with best and this week's values; the rework stat's and mini stat's `title` names task reviews;
   - the 12-week line has 12 slots, this week last, last week marked, the null week a gap, the under-50 week drawn inside the plot; the six sparklines by name, each with a gap for its null week; the phase bars with one bar a week and one segment per key present that week;
   - no `NaN` in any `d`, `points`, `x`, `y`, `width` or `height` attribute of the card's SVG, and every point inside its SVG's viewBox;
   - at 390 and 1440 wide, each chart's SVG width equals its container's width, and still does after a resize.
2. Same test: Where it goes holds Tokens by phase, Hours by phase, USD by phase, USD by model, Tokens, in that order, labelled by the kit's phase keys; with `efficiency` removed from the fixture, Hours, USD, model and Tokens still draw from `metrics`. Sensors › Fleet holds none of the four moved cards and still holds Findings, Set aside and Checks before merge. The source line reads from `cost.source` and names unpriced models. Waste lists each spend finding's detail with no kind id in its text; on the line with an `id` a click and an Enter each open the observation's peek; the line with a null `id` is not focusable and a click opens no peek and throws nothing.
3. Same test: Suggestions lists them numbered, each with its kind's words (no kind id; the unknown kind reads "Suggestion"), its evidence and effect, and no `button`; a click and an Enter each POST one thread with subject `{"kind":"item","ref":"suggestion:<id>"}` and nothing else (every non-GET request recorded); with an open thread on that subject the click opens it and POSTs nothing; the home lookup and `tWhere` place `suggestion:eff-x` on Efficiency and a non-`eff-` suggestion on Trust; with no suggestions it reads "None this week".
4. `test/dashboard-measure.test.mjs` passes in CI with `#efficiency` in `PAGES` at 1440x900, 720x800 and 390x844 on every check. A `PAGES` entry gains an optional `init` (a script added before load with `Page.addScriptToEvaluateOnNewDocument`, removed after), and Efficiency's uses it to rewrite `/api/data` with the fixture, so the charts and rows are measured, not the empty state.
5. Every item the Fleet tab had stays, on Fleet or on Efficiency: the final review checks "Nothing lost" below one by one against the mock.
6. The page's sections are Score, Where it goes, Waste and Suggestions, laid out as Trust's, with no OODA headings and no trials table (check 1 asserts it; the final review compares with the mock at main).

## Nothing lost (Health / Sensors › Fleet, item by item)

| Item today | Where it ends up |
|---|---|
| Findings, each with severity, kind in words, subject link, detail, next step for the supervisor | Fleet (unchanged) |
| Set aside (who, reason, until) | Fleet (unchanged) |
| Hours by phase | Efficiency › Where it goes |
| USD by phase | Efficiency › Where it goes |
| USD by model | Efficiency › Where it goes |
| Tokens: input, output, cache reads, cache writes | Efficiency › Where it goes (Tokens) |
| "Measured from the agents' own session logs" / "Nothing measured…" | Efficiency › Where it goes, the source line |
| Unpriced models | Efficiency › Where it goes, the source line |
| Each empty state (no time yet, no spend recorded) | Efficiency, "None" (obvious copy goes, per design Everywhere) |
| Checks before merge (runs, usual time, fail rate, allowed failures, flaky and often-fails badges, one-off checks counted) | Fleet (unchanged) |
| Flaky tests, Slowest tests | Fleet (unchanged) |

## Edge cases

- `efficiency` missing (an older server): the card draws; Score, Waste and Suggestions read "None" (Suggestions "None this week"), Where it goes draws from `metrics`; no nav count; nothing throws.
- `weeks` all unscored (the G1 fixture: twelve empty weeks): score "–", the line all gaps, sparklines of counts flat at 0 and of nulls all gaps, no phase bars ("None").
- `best` null: ratio lines read "–".
- A phase key present in some weeks only: no segment in the others; a key past the palette's end gets a cycled colour.
- Very long phase or model names: bar labels truncate inside their column (no overflow at 390px).
- Ids in attributes are escaped; refs go through `CSS.escape` when selected.
- The 10 s redraw keeps an open thread's pin and doesn't steal focus.

## Out of scope

Computing anything (all numbers come from `kit-173`); trials (Self Improvement); any change to `shell.md` or the shared blocks; the hub; the Overview's score tiles (`kit-90`); the Sentry sensor example.

## Rulings

- `m-20261115-203712796-supervisor`: plan ahead; build only after `kit-99` and `kit-173` merge and `approve-plan` is recorded; reviewer briefs carry lessons k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule; run only touched test files at `--test-concurrency=2`.
- Owner thread `t-20261115-180708537-owner` (supervisor act 2026-11-15T19:02:20): Efficiency laid out as Trust (Score, Where it goes, Waste, Suggestions), no OODA headings, trials stay on Self Improvement.
- `m-20261115-204118085-supervisor` (to kit-173): first-pass counts each task review (`task-<n>.md`, no variant), and the page's tooltip says so.
