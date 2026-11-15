# kit-174: the Efficiency page beside Trust

Ticket `kit-174-efficiency-page` (kind build, size M, risk normal), feature `dashboard-cleanup`, story DCL-S13, design `project/designs/a-cleaner-more-consistent-dashboard.md` (home), section Autonomy pages › Efficiency. Consumes `docs/devteam/dashboard/shell.md@1`. Depends on `kit-99-autonomy-suggestions` (Trust's Autonomy Score card and its Suggestions list, the `suggestion:<id>` thread subject) and `kit-173-efficiency-data` (`/api/data` `efficiency`). Written ahead of both (ruling `m-20261115-203712796-supervisor`): build starts only once both have merged and `approve-plan` is recorded.

## Why

The owner can't see whether the fleet spends tokens and time well, or what would lower spend without lowering quality: Health lists raw hours, dollars and tokens, and the spend findings scroll by (design, Reverse chain, "(owner) Efficiency"). `kit-173` computes one Efficiency Score a week (spend, time and rework against the best of the last 12 weeks, quality held) plus where the spend goes, the waste and ranked suggestions. This ticket draws it as its own page, beside Trust, laid out as Trust's Autonomy Score is, and moves Health's four spend cards onto it.

## The reference

The mock at main, `project/artifacts/dashboard-cleanup/index.html` (home): `efficiencyScore()` and its helpers (`phaseBars`, `effBars`, the Waste rows, `suggestionsList(EFF_SUGG)`), the nav entry, and Notes' inventory lines for Health and Efficiency. The owner settled the layout on threads `t-20261115-180708537-owner` and `t-20261115-190001527-owner`: sections Score, Where it goes, Waste and Suggestions; no Observe, Orient, Decide or Act headings; no trials table (trials stay on Self Improvement). Where this spec and the mock differ in wording, the mock wins; where the mock draws fake numbers, the page draws `efficiency`'s.

## How it works at kit main today (`de07a84`), and what the dependencies change

- Health (`<section id="health">`, index.html ~899) holds Findings, Set aside, Hours by phase (`#phase-time`, `bars(m.phase_hours)`), USD by phase (`#phase-cost`), USD by model (`#model-cost`, from `m.cost.by_model[k].usd`), Tokens (`#token-note`: "Measured from the agents' own session logs. Input · output · cache reads · cache writes", the unpriced models in red, or "Nothing measured: spend shows only what agents reported."), Checks before merge (`#gates`) and the flaky and slowest test lists (`#test-lists`); drawn in `render()` ~4716–4752. `#health` already redirects to `#sensors?st=fleet` in `SHELL_ROUTES`.
- `kit-87` makes each nav item a page (`registerPage`), `kit-93` makes Trust the Autonomy Score card (ruled `.sec g12` sections, `c3 lbl` label column, `c9` body; charts drawn at the width they get, with `fitCharts`-style redraw) and Sensors › Fleet today's Health, `kit-99` adds the Suggestions section and the click-to-thread behaviour on `{"kind":"item","ref":"suggestion:<id>"}` (opening the open thread if there is one, via `kit-97`). This ticket reuses those pieces as they land; it doesn't re-implement them.
- `T_HOME` (~4789) and `T_WHERE` (~4913) map an item ref's prefix (before `:`) to a page and its words. After `kit-99`, `suggestion` maps to Trust.

## What changes (all in `docs/devteam/dashboard/index.html`, plus tests)

1. **The page.** `registerPage({ id: 'efficiency', title: 'Efficiency', group: 'Autonomy', icon: 'zap', count, render })`, placed so the nav's Autonomy group reads Trust, Efficiency, then the rest as they are. `'efficiency'` joins `SHELL_ROUTES.pages` (and `T_SECTIONS`) right after `trust`. The nav count is this week's score as `NN%` (the mock's `72%`), blank when this week has no score or `efficiency` is missing.
2. **One card**, `Efficiency Score` (card head as Trust's, icon `gauge`, right label "this week"), in ruled sections, each a `c3` label and a `c9` body, as Trust's card is:
   - **Score.** This week's score big, "last week NN%" beside it (each "–" when null); the line "spend, time and rework against the best of the last 12 weeks, with quality held"; three stats, spend, time and rework, each its percentage and its ratio in words (spend: "best $B ÷ this week $T per point"; time: "best B ÷ this week T hours per point"; rework: "reviews passed the first time"); the score's 12-week line, drawn by Trust's line helper, oldest first, this week last and last week marked, a null week a gap (no point, the line broken); six mini stats, three per row, each its number and a sparkline over the 12 weeks: $ per merged point (this week · best), hours per merged point (this week · best), reviews passed the first time (%), cache reads of input tokens (%), escaped defects ("N (target 0)"), merged points; then "Spend by phase, each week": one stacked bar a week, one segment per key of the weeks' `usd_by_phase` in a stable order (the union of keys, ordered by total spend, largest at the bottom), colours from the series palette by that order, each segment's title "<week>: <phase> $x of $total", a legend with this week's dollars per key, labelled by the kit's phase keys as they come.
   - **Where it goes.** Five bar blocks, two across (`c6`), each a `props-h` heading with an icon: Tokens by phase (millions; `efficiency.observe.tokens_by_phase`, a phase's total of input, output, cache read and cache write), Hours by phase (`phase_hours`), USD by phase (`phase_usd`), USD by model (`cost.by_model[k].usd`), Tokens (millions: cache read, input, cache write, output from `cost.tokens`). Each is labelled by the kit's own keys and sorted largest first; empty data reads "None". Under them, one line on where the figures come from (the gap audit's item, Notes: "Efficiency (kit-174): where the spend figures come from, under Where it goes"): "Measured from the agents' own session logs" when `cost.source` is `measured`, else "Nothing measured: spend shows only what agents reported", then "· Unpriced: <models>" when `cost.unpriced_models` has any (in the error colour, as today). The session and settings-priced counts the mock shows are not in the data and are not drawn.
   - **Waste.** `efficiency.waste` as `.rows` of `.rowline` lines: an amber dot, the finding's `detail` in plain words, and on the right its kind in plain words (`costly ticket`, `low cache hits`, `cost per point rising`, `cost hotspot`, `unpriced model`, from one map; never a kind id) and its dollars when the detail or record carries them. Each line is focusable and opens its observation's peek on a click or Enter. Empty: "None".
   - **Suggestions.** `efficiency.suggestions`, numbered, drawn by kit-99's suggestions list (title from its kind, `what`, its evidence and estimated effect), with no buttons. A click or Enter on one starts a thread on `{"kind":"item","ref":"suggestion:<id>"}`, or opens the open thread on it if one exists, exactly as Trust's do; nothing else is written. Empty: "None this week".
3. **Where an `eff-` suggestion lives.** `T_HOME` and `T_WHERE` are keyed by prefix, so a lookup helper (`tHomeOf(ref)` / the one `kit-99` uses, if it adds one) places `suggestion:eff-…` on `efficiency` / "Efficiency" and every other `suggestion:` on Trust. The thread's floating card and pin find the suggestion on the Efficiency page; `tWhere` reads "Efficiency".
4. **Sensors › Fleet loses the four spend cards** (Hours by phase, USD by phase, USD by model, Tokens) and their render lines; Findings, Set aside, Checks before merge and the flaky and slowest test lists stay, unchanged.
5. **Charts at the width they get.** The score line, sparklines and phase bars redraw at their container's width on render and resize, as Trust's do, so mono labels keep one size.
6. **Running text** stays within `--measure`; the page passes every check in `test/lib/measure.mjs`.

## Contracts

- Consumes `shell.md@1`: `registerPage`, the layout block's `.g12`, `.sec`, `.rows`, the measure check. Adding a page id is the router table's job (outside the frozen blocks), so no block changes. shell.md §5's prose list of page ids won't name `efficiency`; shell.md is outside this ticket's touches, so the review request asks the supervisor whether that sentence needs a note (recommendation: no version bump, the list is the router table's).
- Consumes `/api/data` `efficiency` as `kit-173` lands it: `weeks[]` (12, oldest first: `week`, `usd_per_point`, `points`, `tickets`, `hours_per_point`, `first_pass`, `cache_read_share`, `escaped_defects`, `usd_by_phase`, `tokens_by_phase`, `score`, parts), `this_week` / `last_week` scores and this week's `parts` (spend, time, rework), `observe` (`phase_hours`, `phase_usd`, `by_model`, `tokens`, `tokens_by_phase`), `waste[]` (`id`, `kind`, `subject`, `detail`), `suggestions[]` (`id`, `kind`, `what`, `evidence`, `effect`). Exact field names are taken from kit-173's merged code at plan-update time; a mismatch with this list is fixed in the plan, not by changing kit-173. **Assumption to confirm:** a waste item's `id` names its observation (metrics findings become observations, `observeFindings`), so it opens `#observation/<id>`; if kit-173 gives a finding key instead, the page opens the observation whose source key matches, and if neither is possible this is a `design-change` message.
- Consumes kit-99's suggestion list and click-to-thread; kit-97's one-thread-per-subject.

## Acceptance checks (the done-whens)

1. `test/dashboard-efficiency.test.mjs` passes in CI (headless Chrome), with `/api/data` rewritten in the page (as `dashboard-answers.test.mjs` does) to carry a fixture `efficiency` with known values (one null-score week, one week with an escaped defect, four phase keys):
   - the nav's Autonomy group has Efficiency right after Trust, its count this week's score;
   - `#efficiency` is one card, Efficiency Score, with sections Score, Where it goes, Waste, Suggestions in that order and no Observe, Orient, Decide or Act heading and no trials table;
   - Score shows this and last week's score, spend, time and rework with their ratios, the 12-week line with 12 slots, this week last, last week marked, the null week a gap; the six sparklines by name; the phase bars with one bar a week and one segment per key of `usd_by_phase`.
2. Same test: Where it goes holds Tokens by phase, Hours by phase, USD by phase, USD by model, Tokens, in that order, labelled by the kit's phase keys; Sensors › Fleet holds none of the four moved cards and still holds Findings, Set aside and Checks before merge; the source line reads from `cost.source` and names unpriced models. Waste lists each spend finding's words with no kind id in the text, and a click and an Enter each open the observation's peek.
3. Same test: Suggestions lists them numbered with evidence and effect and no `button`; a click and an Enter each POST one thread with subject `{"kind":"item","ref":"suggestion:<id>"}` and nothing else (every non-GET request recorded); with an open thread on that subject, the click opens it and POSTs nothing; `tWhere`/the home lookup place `suggestion:eff-x` on Efficiency and a non-`eff-` one on Trust; with no suggestions it reads "None this week".
4. `test/dashboard-measure.test.mjs` passes in CI with `#efficiency` in `PAGES` (with the fixture data, so the charts and rows are measured, not just empty states) at 1440x900, 720x800 and 390x844 on every check.
5. Every item the Fleet tab had stays, on Fleet or on Efficiency: the final review checks the list in "Nothing lost" below one by one against the mock.
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

- `efficiency` missing (older server) or `weeks` empty: the page draws the card with "None" in each section and no nav count; nothing throws.
- Every week null-scored: the line draws no points (all gaps), score reads "–".
- A phase key present in some weeks only: it is a segment of zero in the others; a phase key that is new (not in the palette order) still gets a colour (palette cycles).
- Very long phase or model names: bar labels truncate inside their column (no overflow at 390px).
- Peek ids and suggestion ids are escaped in attributes; refs go through `CSS.escape` where selected.
- Re-render every 10 s keeps an open thread's pin and doesn't steal focus.

## Out of scope

- Computing anything (all numbers come from `kit-173`); trials (Self Improvement); any change to `shell.md` or the shared blocks; the hub; the Sentry sensor example.

## Rulings

- `m-20261115-203712796-supervisor`: plan ahead; build only after `kit-99` and `kit-173` merge and `approve-plan` is recorded; reviewer briefs carry lessons k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule; run only touched test files at `--test-concurrency=2`.
- Owner threads `t-20261115-180708537-owner`, `t-20261115-190001527-owner` (supervisor act 2026-11-15T19:02:20): Efficiency laid out as Trust (Score, Where it goes, Waste, Suggestions), no OODA headings, trials stay on Self Improvement.
