# kit-173-efficiency-data: spec

The Efficiency Score's data: spend, time and rework per week against the best of 12, the spend findings, trials and suggestions. Feature `dashboard-cleanup`, story DCL-S13. The design is `project/designs/a-cleaner-more-consistent-dashboard.md`, Autonomy pages › Efficiency (owner thread `t-20261115-180708537-owner`; rulings `m-20261115-180749895-supervisor`, `m-20261115-180754382-supervisor`). This ticket computes `/api/data` `efficiency` on read; `kit-174` draws it. Nothing is stored.

## Why

The owner can't see whether the fleet spends tokens and time well, or what would lower spend without lowering quality. Health lists raw hours, dollars and tokens and spend findings scroll by. One score per week, compared with the best of the last 12, plus the loop on spend (Observe, Orient, Decide, Act), gives them that.

## Approach

One sensible way: a function `efficiencyData(m)` in `devteam.mjs`, called by `dashboardData()` with the `collectMetrics(0)` it already computes, so every input is the same code `metrics --json` uses. Alternatives dropped: a separate pass re-reading spend and cycles (two codes for one figure, which the design forbids: "computed by the same code"), and storing weekly figures (the design says derived on read, stored nowhere).

`collectMetrics` keeps its JSON output byte-for-byte; it also hangs its internals (the cycles, per-ticket spend, the `perPoint` function, the spend items it read) on the result as one non-enumerable property, so `JSON.stringify` (and so `metrics --json`, the golden `metrics.txt`) doesn't change. `efficiencyData` reads review records once per request (one walk over every ticket's `reviews/`, the same sources `reviewStats` reads) and groups them by the ticket's merge week.

The 12 weeks are `kit-98`'s: the last 12 calendar weeks (`mondayOf`, Monday 00:00 UTC to the next), oldest first, ending with this week. If `kit-98` lands a helper for them, this ticket uses it; otherwise it builds them from `mondayOf` and `WEEK` the same way.

## The shape: `efficiency`

```
efficiency: {
  weeks: [ {                         // 12, oldest first, the last is this week
    starts_at,                       // ISO, the Monday 00:00 UTC
    tickets, points,                 // the week's tickets: merged in it with spend recorded (perPoint's set); 0 and 0 with none
    usd_per_point,                   // perPoint(weekStart, weekEnd).usd_per_point (2 places, as perPoint rounds); null with no tickets
    hours_per_point,                 // sum of their cycles (first phase line to merge, as cycle_hours) in hours over points, 2 places; null with none
    first_pass, first_passes,        // share not CHANGES of their first-pass ticket-stage reviews, 2 places; 1 with none
    cache_read_share,                // cache_read / (input + cache_read + cache_write) over the week's spend items; null with none (or a zero denominator)
    escaped_defects,                 // escaped-defect observations created in the week
    usd_by_phase,                    // the week's spend items' usd by phase, phase_usd's keys, rounded to cents
    tokens_by_phase,                 // { <phase>: { input, output, cache_read, cache_write } } over the week's spend items
    score,                           // 0..100, null when tickets < 3
    parts,                           // { spend, time, rework }, each 0..1 to 2 places, or null when unscored
  } ×12 ],
  best: { usd_per_point, hours_per_point },   // lowest among scored weeks; null when none
  score: { this_week, last_week },            // weeks[11].score, weeks[10].score
  parts: { spend, time, rework },             // this week's, or null
  observe: { phase_hours, phase_usd, by_model, tokens, tokens_by_phase },
  waste: [ { id, kind, subject, detail } ],
  trials: [ { id, what, since, usd_per_point_start, usd_per_point_now, escaped_defects_since, state } ],
  suggestions: [ { id, kind, what, evidence, effect, usd, per } ],   // at most 5
}
```

**The week's spend items** are the spend items (`spendItems()`, the lines `phase_usd` sums) whose time `at` falls in the week, exactly as `collectMetrics` selects items for its window, whoever spent them; this is the set for `cache_read_share`, `usd_by_phase`, `tokens_by_phase` and the smaller-model condition. The week's *tickets* are a separate set (merged in the week with spend recorded) and are what `usd_per_point`, `hours_per_point` and `first_pass` count.

**Rounding.** `hours_per_point` sums the cycles' raw milliseconds, then divides and rounds to 2 places; `cache_read_share` is rounded to 2 places; `usd_by_phase` to cents per phase; a suggestion's `usd` to cents. The score is computed from the weekly figures as emitted (the rounded `usd_per_point`, `hours_per_point`, `first_pass`), with unrounded parts inside the score's formula; the emitted `parts` are then rounded to 2 places. So a hand computation from the output reproduces every score.

**One read of the review files.** Today a dashboard request reads every ticket's review records four times: `dashboardData` runs `collectMetrics(0)` directly and again through `collectOoda` → `collectRoadmap`, and each run calls both `reviewStats()` and `reviewPasses()`, each of which reads every ticket's `reviews/`. One walk, `ticketReviewWalk()`, returns every ticket's records as a `Map` by ticket id, memoized for the length of one `dashboardData()` call (set at entry, cleared in `finally`, so the server reads fresh on each request); `reviewStats`, `reviewPasses` and `efficiencyData` all read their tickets' records from it, so a request reads each ticket's review folder once. Outside a dashboard request (the CLI's `metrics`, `check-ticket`, …) nothing is memoized and behaviour is as today. `reviewStats`' and `reviewPasses`' outputs are unchanged. The test counts real reads (each ticket review folder read through `ticketReviews` for the walk adds one to a counter, printed under a `DEVTEAM_TEST_*` variable) and expects exactly one per ticket per request.

**Reading review records by file name.** `parseReview` reads `task-2.md` as stage `task`, pass 2, and `task-2-2.md` as stage `task-2-2`; for first and later passes this ticket classifies a ticket's records by file name instead: `^(spec|plan|final)-(\d+)([a-z]?)\.md$` (pass 1 with empty track is the first pass; pass > 1 with empty track a later pass), `^task-(\d+)\.md$` a task first pass, `^task-(\d+)-(\d+)\.md$` a later task pass; for first and later passes, a record with a track letter, and any other stage (contract, design, graph), is not counted. (The per-pass estimate's count of final records, below, is separate and counts every final record, tracks included.) Contract records are left out because the design names the ticket stages it counts (spec, plan, task, final); a contract review is the supervisor's word on an interface, not a pass of the ticket's own work. The verdict still comes from `parseReview`.

Keys that carry clock values end in `_at` or are `since`, so the G1 golden's timeless filter drops them; no week name (`2026-W46`) is emitted, since it moves with the date the suite runs (kit-174 labels weeks from `starts_at`).

## Acceptance checks (the done-whens)

1. **Per week.** `test/efficiency-data.test.mjs` builds fixture logs with known answers and reads `/api/data` (`dashboard-data`) `efficiency.weeks`: 12 entries, oldest first, the last starting this Monday; for each, over the tickets merged that week with spend recorded: `usd_per_point` and `points` (`perPoint` over the calendar week, not `per_point_this_week`), `hours_per_point` (their cycle hours, as `cycle_hours` counts them, over their points), `first_pass` (below), `cache_read_share` (null with no spend items), `escaped_defects`, `usd_by_phase`, `tokens_by_phase`.
   - **first_pass:** review records of the week's tickets in ticket stages only (`spec`, `plan`, `task`, `final`; design and graph reviews are a plan's and never counted); first passes are pass 1 with no variant, and for `task` every `task-<n>.md` with no variant (worker.md: `task-<n>.md` is task n's first review; `task-<n>-<p>.md` is a later pass) (ruling `m-20261115-204118085-supervisor`: first-pass counts each task review; `reviews.by_stage` stays as it is; kit-174's tooltip says so); a fixture with `task-1.md`, `task-2.md` and `task-2-2.md` counts two task first passes; a record with no verdict is skipped; the share not `CHANGES`; 1 with none. A review counts in its ticket's merge week. The review files are read once per request (above: each ticket's folder read exactly once per `dashboard-data` run).
2. **The score**, against hand-computed answers: `best_usd`, `best_hours` the lowest among the scored weeks (tickets ≥ 3); spend = min(1, best_usd / usd_per_point) (1 when usd_per_point is 0); time likewise with hours; rework = first_pass; a week with an escaped defect takes, for spend and for time, the lowest uncapped value of the other scored weeks, 0 when there is none (so one scored week with a defect scores rework only); score = round(100 × (spend + time + rework) / 3); a week with fewer than 3 tickets has its counts and `score: null`, `parts: null`; `score.this_week`, `score.last_week` and this week's `parts` are given.
3. **Observe, waste, trials.** `observe` is the window's (`collectMetrics(0)`'s) `phase_hours`, `phase_usd`, `cost.by_model` and `cost.tokens` exactly as metrics gives them, plus `tokens_by_phase` over the same spend items. `waste` is `m.findings` (open, not acknowledged) of kinds `cost-hotspot`, `costly-ticket`, `low-cache-hit`, `cost-per-point-rising`, `unpriced-model`, each `{ id, kind, subject, detail }`, `id` the newest metrics observation recording it (`source_key` `metrics:<kind>:<subject>`), null until one is logged. `trials`: every act with `class: 'improvement-trial'` whose `refs` include the id of an observation of one of those five kinds, or whose `what` matches `/cost[- ]per[- ](merged )?point/i`, newest first: `id` (the act's), `what` (its `what`), `since` (its `created_at`), `usd_per_point_start` (`perPoint(since − 7 days, since)`'s `usd_per_point`, null with no points), `usd_per_point_now` (`perPoint(since, now + 1)`'s, null likewise), `escaped_defects_since` (escaped-defect observations created at or after since), `state`: `running` when no observation of kind `outcome` has the act's id in its `refs`, else by the newest such outcome (by `created_at`): `kept` at valence ≥ 0 (a missing valence reads 0), `dropped` below 0.
4. **Suggestions.** Up to five whose condition holds this week (the calendar week, `weeks[11]`), ranked by estimated dollars (`usd`, descending; ties by id), each `{ id, kind, what, evidence, effect, usd, per }` with `per` `week` for every kind but `costly-ticket` (`once`). `what`, `evidence` and `effect` are plain sentences for the owner (strategy R2): no kind id, phase key or model id without words around it, a model by its name in words (`claude-sonnet-5-5` → "Sonnet 5.5": the family capitalised, the version's dashes as dots), dollars as `$12`, e.g. what "Try Sonnet 5.5 for building, outside reviews and specs", evidence "Opus 5.5 was 95% of this week's $60", effect "about $10 a week". `id` = `eff-<kind>-<subject>`, lowercased, every character outside `[a-z0-9-]` a dash, at most 110 characters, so that once `kit-99` adds the `suggestion` subject type, `suggestion:<id>` passes `SUBJECT_REF` (the test checks the id against `SUBJECT_REF`'s id part, `^[a-z0-9][a-z0-9-]{0,110}$`, since the type itself isn't this ticket's); built from no rank or date, so stable while its condition holds; one whose condition stops holding drops out. The test checks every suggestion's `what`, `evidence` and `effect` hold no hyphenated kind id (`review-depth`, `smaller-model`, `costly-ticket`, `tighter-specs`, or a finding kind such as `low-cache-hit`; the word "cache" is plain English), no phase key in code form (`final-review`), and no `claude-` model id. The kinds:
   - **`review-depth`** (subject `s-normal`): the week's size S, risk normal tickets have ≥ 3 spec or plan review records with a verdict between them. usd = that count × the per-pass estimate.
   - **per-pass estimate:** the median, over the 12 weeks' tickets with at least one `final` review record, of (the sum of the ticket's spend items with `role: reviewer` and phase `final-review` or `review` — `review` is the phase `phaseAtFor` gives a reviewer whose spend `spenderFor` attributes from a `review-*` worktree; the kit can't tell those apart from other reviewer-phase spend, so all of it counts) / its number of final records (files `final-<p>[<track>].md` with a verdict, every pass and track: each is a reviewer's pass). No such ticket → no estimate → neither review-depth nor tighter-specs is made.
   - **`smaller-model`** (subject the model key): this week's spend items total > $50 and one model has > 90% of it. Target: the same version one family down (families from the top: fable and mythos, opus, sonnet, haiku); when that version isn't priced, the newest priced version of that family (by version numbers); a model is *priced* only when its key (after `modelKey`) is itself a key of `MODEL_PRICES` or of `settings.model_prices` — `priceFor`'s longest-prefix fallback does not make a version priced (so `claude-fable-5-1` does not point at an unpriced `claude-opus-5-1`, but at the newest priced opus). Keys parse as `claude-<family>-<version>`, the version's dash-separated numbers compared left to right (`5-5` > `5` > `4-8`). Prices for the effect come from `priceFor` (`settings.model_prices` overriding). `claude-opus-5-5` → `claude-sonnet-5-5`. No target, or a target whose output price isn't lower → none. usd = the dominant model's spend this week outside phases `final-review`, `review`, `spec`, `plan`, `planning`, × (1 − target output price / dominant output price).
   - **`cache`** (subject `prompt-cache`): a `low-cache-hit` finding is open. usd = max(0, 0.6 × input side − cache reads) tokens over the finding's window (the last 7 days' spend items, as the finding counts) × (input price − cache-read price) of the window's highest-spend priced model, per million.
   - **`costly-ticket`** (subject the ticket id): each open `costly-ticket` finding. usd = the ticket's spend − median × its points, the median computed exactly as the finding does (`m.cost.by_ticket` per point of merged tickets, sorted, the element at `floor(n / 2)`); `per: once` (a one-off sum, still ranked by its dollars).
   - **`tighter-specs`** (subject the stage): a ticket stage whose first passes among the week's tickets number ≥ 4 with more than half `CHANGES`. usd = that stage's later passes among the week's tickets (pass > 1 with no variant; for `task`, each `task-<n>-<p>.md`) × the per-pass estimate.
5. **Golden.** `test/fixtures/g1/dashboard-data.txt` gains the `efficiency` block the G1 fixture yields (twelve empty weeks, nulls, no suggestions); nothing else in it moves. `metrics.txt` does not change.

## Contracts

Provides `/api/data` `efficiency` (above), consumed by `kit-174`. Consumes `collectMetrics`, `spendItems`, `priceFor`, `MODEL_PRICES`, review records (`parseReview`), `kit-98`'s 12 calendar weeks. No log line, schema or command changes.

## Edge cases

- No spend items at all (`cost.source` reported): `ticketUsd` comes from the phase lines' reported `usd`, so `perPoint` still counts tickets and weeks still score; `cache_read_share` is null, `usd_by_phase` and `tokens_by_phase` are `{}`, and no suggestion that reads spend items (smaller-model, cache, the per-pass estimate) is made. With neither (G1), every week has 0 tickets and no score.
- A week with an escaped defect still counts toward `best` (the design: best is the lowest among the scored weeks); it just can't score its own saving.
- A week whose tickets have points but a 0-hour total can't happen (cycles are > 0); a `usd_per_point` of 0 scores spend 1.
- All scored weeks have defects: each takes its others' lowest raw value; with only one scored week, spend = time = 0.
- A model key with a date or region prefix is normalized by `modelKey` before families are read; an unknown family gets no smaller-model suggestion.
- Findings acknowledged (`finding-ack`) aren't open, so they're neither waste nor suggestion conditions.
- Review records on unmerged tickets are never counted (the week's tickets are merged).

## Out of scope

The page (`kit-174`); changing `reviews.by_stage`, the findings, or `metrics --json`; storing anything; trust-score suggestions (`kit-99`).

## Rulings

- `m-20261115-203704194-supervisor`: plan ahead; build only after `kit-98` merges and approve-plan is recorded; briefs carry lessons k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule; run only touched test files at --test-concurrency=2.
- `m-20261115-204118085-supervisor` (re `m-20261115-204110797-kit-173-efficiency-data`): option B. For the task stage every `task-<n>.md` with no variant is a first pass and `task-<n>-<p>.md` stays out; `reviews.by_stage` is left as it is; the spec and kit-174's page tooltip say first-pass counts each task review; a test with `task-1.md`, `task-2.md` and `task-2-2.md` counts two first passes.
