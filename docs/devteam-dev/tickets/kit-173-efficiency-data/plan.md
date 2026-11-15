# kit-173-efficiency-data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- One new function, `efficiencyData(m)`, in `docs/devteam/scripts/devteam.mjs`, called by `dashboardData()` with the `collectMetrics(0)` it already has; `/api/data` gains `efficiency`.
- `collectMetrics` hangs its internals (cycles, per-ticket spend, `perPoint`, spend items) on the result as one non-enumerable property, so `metrics --json` and `metrics.txt` don't move.
- Ticket review folders are read once per dashboard request: a per-request memo inside `ticketReviews`, which `deriveStatus`, `reviewStats`, `reviewPasses` and `efficiencyData` all go through.
- Four tasks, one per done-when: weekly measures, the score, Observe/waste/trials, suggestions. Each grows `test/efficiency-data.test.mjs` and re-records the G1 golden only where G1's output changes.
- Fixtures: a `fleetFixture` project with tickets added by CLI, phase, spend and observation lines written by hand at chosen times, and merges made with `GIT_COMMITTER_DATE` in chosen calendar weeks.
- Build waits for `kit-98` to merge and approve-plan; if `kit-98` lands a 12-week helper, Task 1 uses it instead of its own.
- Tests run one file at a time at `--test-concurrency=2`; CI is the gate.

**Goal:** `/api/data` carries `efficiency` as `spec.md` defines it.

**Architecture:** Pure derivation on read inside the kit's single script, reusing `collectMetrics`' own computations over calendar weeks. No new store, log line, command or schema.

**Tech Stack:** Node (ESM), `node:test`, the kit's test helpers in `test/lib/kit.mjs`.

**Spec:** `docs/devteam-dev/tickets/kit-173-efficiency-data/spec.md` (this repo); design `docs/devteam/project/designs/a-cleaner-more-consistent-dashboard.md` › Efficiency (home).

## Global Constraints

- Touches only `docs/devteam/scripts/devteam.mjs`, `test/efficiency-data.test.mjs`, `test/fixtures/g1/dashboard-data.txt`.
- Weeks: 12 calendar weeks, `mondayOf` (Monday 00:00 UTC), oldest first, ending with this week; each `{ starts_at, … }`, no ISO week name.
- Points: S 1, M 2, anything else 1 (as `perPoint`).
- A week is scored only with ≥ 3 tickets.
- Suggestion id: `eff-<kind>-<subject>`, lowercased, `[^a-z0-9-]` → `-`, sliced to 110; kinds `review-depth`, `smaller-model`, `cache`, `costly-ticket`, `tighter-specs`; at most 5, by `usd` desc then id.
- Spend kinds: `cost-hotspot`, `costly-ticket`, `low-cache-hit`, `cost-per-point-rising`, `unpriced-model`.
- Ticket review stages: `spec`, `plan`, `task`, `final`, classified by file name (never `parseReview`'s `stage`/`pass`): `^(spec|plan|final)-(\d+)\.md$` pass 1 first, > 1 later; `^task-\d+\.md$` a task first pass; `^task-\d+-\d+\.md$` a later task pass; track letters and other stages out. Verdict from `parseReview`; none → skipped (ruling `m-20261115-204118085-supervisor`).
- Priced model = a key (after `modelKey`) present exactly in `MODEL_PRICES` or `settings.model_prices`; never `priceFor`'s prefix fallback.
- Suggestion texts: no hyphenated kind id, no `final-review`-style phase key, no `claude-` id; models in words (`Sonnet 5.5`).
- `metrics --json` output unchanged; G1 `metrics.txt` unchanged.
- Code style: the file's own (dense one-liners where neighbours are, comments say why). No new dependency.

## Review Focus

1. **A run near Monday 00:00 UTC.** Fixture times for "this week" must not land in the future or in last week, and must stay distinct: `at(k, f)` = for k < 11, `monday(k) + f × 6 days`; for k = 11, `thisMonday + f × (Date.now() − thisMonday) × 0.9`, f ∈ (0, 1). Each ticket's phase line at f, its spend at f + 0.1, its merge at f + 0.2, so phase < spend < merge in every week. Every hand-written line has a unique id (a counter in the id), so `fold` never drops one. (Task 1 helper.)
2. **The server path, not just the CLI.** `/api/data` from a running dashboard carries the same `efficiency` as `dashboard-data` — and a second request after new spend lines sees them (the review-walk memo is per request, not per process). (Task 1 test.)
3. **No spend at all** (G1): twelve weeks of zeros/nulls, `best` nulls, `score` nulls, empty arrays; no throw. (Task 1 golden, Task 4 test.)
4. **A model with a date suffix or region prefix** (`us.anthropic.claude-opus-5-5-20261001`) still finds `claude-sonnet-5-5`; an unknown family yields no smaller-model suggestion. (Task 4 test.)
5. **An acknowledged spend finding** (a `finding-ack` observation) is neither waste nor a suggestion's condition. (Task 3 test.)

---

### Task 1: The weeks and their measures (done-when 1)

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs` — `reviewStats` (~3957), `collectMetrics` (~11224), `dashboardData` (~11828); new `efficiencyData` after `collectMetrics`.
- Create: `test/efficiency-data.test.mjs`
- Modify: `test/fixtures/g1/dashboard-data.txt`

**Interfaces:**
- Produces: a memo inside `ticketReviews(id, src)` keyed `${id}\0${src.ref ?? 'worktree'}`, active only while `dashboardData()` runs (`reviewMemo = new Map()` at entry, `null` in `finally`); `reviewReads` counts memo misses (real folder reads); when `process.env.DEVTEAM_TEST_REVIEW_READS` is set, `cmdDashboardData` writes `review reads: <n>` to stderr. `ticketReviewWalk()` → `Map<ticketId, record[]>` over every ticket with the same source choice `reviewStats` makes, for `efficiencyData`. No caller's output changes.
- Produces: `m[METRICS_INTERNALS]` (a `Symbol`, non-enumerable via `Object.defineProperty`) = `{ cycles, ticketUsd, perPoint, items, POINTS }`.
- Produces: `efficiencyWeeks(now)` → `[{ start, end }] ×12` (ms); `firstPassOf(records)` → `{ first_passes, rejected }`; `efficiencyData(m)` → the spec's object with `weeks` filled, `best`, `score`, `parts` null, `observe` null, `waste`/`trials`/`suggestions` `[]` (filled by Tasks 2–4).

- [ ] **Step 1: Fixture helpers and failing tests** in `test/efficiency-data.test.mjs`: a `fleetFixture('eff-weeks')`; helpers `addTicket(id, size, risk)` (CLI `ticket add`, SUP), `hand(by, obj, atMs)` (a line in `run/log`, as `ooda-signals.test.mjs`' `handFor` but at an absolute time and with a counter in every id), `phase(id, to, atMs)` (written by the ticket), `spend(id, { role, phase, usd, input, output, cache_read, cache_write, model, atMs })` (a `spend` line written by `supervisor`, the only writer the schema allows, `who` = id, `through` = atMs, `by_model: { [model]: { usd, output_tokens } }`), `merge(id, atMs)` (branch, commit, `merge --no-ff -m "Merge pull request #n from t/ticket/<id>"` with `GIT_COMMITTER_DATE`/`GIT_AUTHOR_DATE` = atMs, push), `reviewFile(id, name, verdict|null)` (written under main's `docs/devteam/project/tickets/<id>/reviews/`, committed), `at(k, offsetHours)` (week k of 12, 0 oldest, Review Focus 1). Tests:
  - `weeks: twelve calendar weeks, oldest first, ending this week` — `weeks.length === 12`, `weeks[11].starts_at` is this Monday 00:00Z, each 7 days after the last.
  - `per-week measures from known logs` — week 9: tickets A (S, $3, phase line 10 h before merge), B (M, $8, 20 h), C (S, $1, 2 h): `tickets 3, points 4, usd_per_point 3, hours_per_point 8`; a ticket merged that week with no spend isn't counted; a ticket with spend merged in week 8 lands in week 8; `usd_by_phase` `{ build: …, 'final-review': … }` and `tokens_by_phase` from the lines' tokens; `cache_read_share` = reads / (input + reads + writes) to 2 places; a week with no spend items has `cache_read_share: null`; `escaped_defects` counts `escaped-defect` observations created in that week; `usd_per_point` ≠ `metrics.cost.per_point_this_week` in a fixture where they differ.
  - `first_pass: ticket stages only, first passes, verdicts only` — A: `spec-1.md` APPROVE, `plan-1.md` CHANGES, `plan-2.md` APPROVE, `spec-1b.md` CHANGES (variant, out), `task-1.md` APPROVE, `task-2.md` CHANGES, `task-2-2.md` APPROVE (out), `final-1.md` with no verdict (skipped), `design-1.md` CHANGES (out): first passes 4, rejected 2, `first_pass 0.5`; a week with none reads `first_pass: 1`.
  - `task first passes count each task review` — task-1.md, task-2.md, task-2-2.md → 2 task first passes (ruling).
  - `review folders are read once per request` — `dashboard-data` with `DEVTEAM_TEST_REVIEW_READS=1` prints `review reads: <n>` with n = the number of tickets (each folder once, though `deriveStatus` and `collectMetrics` each run twice and `collectMetrics` calls both `reviewStats` and `reviewPasses`).
  - `/api/data carries the same efficiency, fresh per request` — `startDashboard`, GET `/api/data` deep-equals the CLI's `efficiency.weeks`; add a spend line, GET again: the week's `usd_by_phase` moved.
- [ ] **Step 2: Run** `node --test --test-concurrency=2 test/efficiency-data.test.mjs` — FAIL (`efficiency` undefined).
- [ ] **Step 3: Implement.** In `collectMetrics`, `Object.defineProperty(m, METRICS_INTERNALS, { value: {…} })` right after `m` is built, before the findings are added. `efficiencyWeeks(now)`: `mondayOf(now) - (11 - i) * WEEK` for i 0..11 (or `kit-98`'s helper if it exists by then). Per week: tickets = `cycles` whose `mergedAt` ∈ [start, end) and `ticketUsd[id] !== undefined`; `perPoint(start, end)`; hours = Σ their `ms` / 3.6e6 / points, rounded as `hours()` does; first pass over `ticketReviewWalk().get(id)`; spend items with `at` ∈ [start, end) for `usd_by_phase` (rounded to cents), `tokens_by_phase`, `cache_read_share` (2 places); `escaped_defects` by observation `created_at`. Wire `efficiency: efficiencyData(metrics)` into `dashboardData` (compute `collectMetrics(0)` once into a local and use it for `metrics` too).
- [ ] **Step 4: Run** the test file — PASS. Then `DEVTEAM_G1_RECORD=1 node --test --test-concurrency=2 test/components.test.mjs`, and check `git diff test/fixtures/g1/` adds only the `efficiency` block to `dashboard-data.txt` (`metrics.txt` unchanged); then run `components.test.mjs` without the variable — PASS.
- [ ] **Step 5: Commit** `kit-173: T1 the weeks and their measures`, via `gate test -- node --test --test-concurrency=2 test/efficiency-data.test.mjs`.

### Task 2: The score (done-when 2)

**Files:** Modify `devteam.mjs` (`efficiencyData`), `test/efficiency-data.test.mjs`, the G1 golden only if it moves (it shouldn't: G1 has no scored weeks).

**Interfaces:**
- Consumes: Task 1's `weeks` entries.
- Produces: `scoreWeeks(weeks)` → mutates each week's `score`, `parts`; returns `{ best, score, parts }`.

- [ ] **Step 1: Failing tests** (pure numbers through `dashboard-data`, a fixture with 4 scored weeks and 1 under 3 tickets):
  - `a defect week with the lowest dollars still sets best` — w2 $1/pt with a defect, w4 $2/pt: best_usd 1, w4 spend .5; w2 spend = w4's .5.
  - `score against hand-computed answers` — weeks w3 ($4/pt, 10 h/pt, fp 1), w5 ($2/pt, 20 h/pt, fp 0.5), w7 ($5/pt, 5 h/pt, fp 0.75), w11 ($2.5/pt, 8 h/pt, fp 1, 1 escaped defect); w9 with 2 tickets. best_usd 2, best_hours 5. w3: spend .5, time .5, rework 1 → 67; w5: 1, .25, .5 → 58; w7: .4, 1, .75 → 72; w11 (defect): spend = min of others' raw (.5, 1, .4) = .4, time = min(.5, .25, 1) = .25, rework 1 → 55; w9 `score: null, parts: null`, counts kept; `score.this_week 55`, `score.last_week` = w10's (null); `parts` = w11's.
  - `one scored week with a defect scores rework only` — single scored week, fp 0.75, a defect → spend 0, time 0 → `score 25`.
  - `usd_per_point 0 scores spend 1` — a scored week with $0 spend items.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `scoreWeeks` per spec acceptance check 2: raw ratio = best / value (1 when value is 0); spend/time = min(1, raw) without a defect; with one, the minimum raw value among the *other* scored weeks (0 if none); `score = Math.round(100 * (spend + time + rework) / 3)`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `kit-173: T2 the score` via `gate test`.

### Task 3: Observe, waste and trials (done-when 3)

**Files:** Modify `devteam.mjs` (`efficiencyData`), `test/efficiency-data.test.mjs`, the G1 golden (Observe fills from G1's metrics).

**Interfaces:**
- Consumes: `m.phase_hours`, `m.phase_usd`, `m.cost.by_model`, `m.cost.tokens`, `m.findings`, internals' `items` and `perPoint`.
- Produces: `efficiency.observe`, `efficiency.waste`, `efficiency.trials` as in the spec.

- [ ] **Step 1: Failing tests:**
  - `observe is the window's metrics plus tokens_by_phase` — deep-equals `metrics.phase_hours`, `phase_usd`, `cost.by_model`, `cost.tokens` from the same `dashboard-data` output; `tokens_by_phase` sums all spend items per phase.
  - `waste is the open spend findings` — a fixture raising `costly-ticket` (≥5 merged, one ≥$5 and >2× median per point) and `low-cache-hit` (>5M input side, <60% reads in 7 days) and a non-spend finding: waste has exactly the two spend kinds, `{ id, kind, subject, detail }`, `id` null; after `observe-metrics` (SUP) logs them, `id` is the observation's id. A `finding-ack` on `low-cache-hit prompt cache` removes it (Review Focus 5).
  - `trials: spend trials and their state` — acts by hand: T1 `improvement-trial` with refs to a `costly-ticket` observation (running), T2 whose `what` says "cut cost per merged point" with an `outcome` observation citing it at valence 1 (kept), T3 likewise at valence −1 then (older) 1 → newest wins (dropped), T4 an unrelated improvement-trial (absent), a `retro`-class act naming cost per point (absent). T1's `usd_per_point_start` = `perPoint` over the 7 days before it, `usd_per_point_now` from it to now, `escaped_defects_since` counts defects after it.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** waste: `m.findings.filter(kind ∈ SPEND_KINDS)`, id = newest observation with `source_key === 'metrics:<kind>:<subject>'`. trials: acts `class === 'improvement-trial'` where some ref is an observation of a spend kind, or `what` matches `/cost[- ]per[- ](merged )?point/i`; state from the newest `outcome` observation whose refs include the act id.
- [ ] **Step 4: Run** — PASS; re-record G1 as in Task 1 Step 4 and check the diff is only `efficiency.observe`.
- [ ] **Step 5: Commit** `kit-173: T3 observe, waste and trials` via `gate test`.

### Task 4: Suggestions (done-when 4)

**Files:** Modify `devteam.mjs` (`efficiencyData`), `test/efficiency-data.test.mjs`.

**Interfaces:**
- Consumes: Task 1's week tickets and review walk, `m.findings`, `m.cost.by_ticket`, internals' `items`, `priceFor`, `modelKey`, `MODEL_PRICES`, `loadSettings().model_prices`.
- Produces: `effId(kind, subject)` → string; `smallerModel(key)` → model key or null; `perPassEstimate(tickets12)` → number or null; `efficiency.suggestions`.

- [ ] **Step 1: Failing tests:**
  - `suggestion ids are valid thread subjects and stable` — a costly ticket `kit-9-x` gives `eff-costly-ticket-kit-9-x`; spend under the model `us.anthropic.Claude-Opus-5-5-20261001` gives `eff-smaller-model-claude-opus-5-5` (by `modelKey`); a model key over 110 characters (via `settings.model_prices`) gives an id of length 110; every id matches `^[a-z0-9][a-z0-9-]{0,110}$` (the `suggestion` type itself is `kit-99`'s, so no `thread new`); two `dashboard-data` runs back to back give the same ids.
  - `suggestion texts are plain words` — no `what`/`evidence`/`effect` matches `/\b(review-depth|smaller-model|costly-ticket|tighter-specs|low-cache-hit|cost-hotspot|final-review)\b|claude-/`; the smaller-model text names "Sonnet 5.5".
  - `smaller model: same version one family down` — `claude-opus-5-5` → `claude-sonnet-5-5`; `us.anthropic.claude-opus-5-5-20261001` → `claude-sonnet-5-5`; `claude-fable-5-1` → newest priced opus (`claude-opus-5-5`); `claude-haiku-5-5` → none; `claude-sonnet-4-6` → `claude-haiku-5-5` (`haiku-4-6` isn't priced, so the newest priced haiku); `claude-gpt-9` (unknown family) → none; a `settings.model_prices` sonnet-5-5 output at $25 (not below opus' $20) → no smaller-model suggestion; with `settings.model_prices` adding `claude-sonnet-9-9`, `claude-opus-9-9` → it.
  - `smaller-model condition and effect` — this week $60 of spend, opus-5-5 $57 (95%), of which $20 in `build`, $17 in `final-review`, $20 in `spec`: usd = 20 × (1 − 10/20) = 10, `per: 'week'`; at $45 total, or 85% share, absent.
  - `review depth and tighter specs priced per pass` — 12-week tickets with final reviews: X reviewer spend $4 in `final-review` plus $2 in `review` over 2 final records (3/pass), Y $4 over 1 (4), Z $10 over 2 (5) → median 4. This week S/normal tickets with 3 spec/plan records → `review-depth`, usd 12; four size-M tickets (so they don't count toward review depth) whose `plan-1.md` records are 3 CHANGES and 1 APPROVE, with 2 `plan-2.md` → `tighter-specs` subject `plan`, usd 8; with no final records anywhere, neither appears.
  - `cache and costly ticket` — `low-cache-hit` open with 10M input side, 4M reads, model opus-5-5 → missing 2M × (4 − 0.2) / 1e6 = $7.60; a `costly-ticket` on K (M, $40, median $5/pt) → usd 30, `per: 'once'`.
  - `top five by dollars, and dropping out` — six conditions → five, sorted by usd then id; remove the costly ticket's condition (ack its finding) → its suggestion is gone, the others' ids unchanged.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per spec acceptance check 4. Families order `[['fable','mythos'],['opus'],['sonnet'],['haiku']]`; parse a key as `claude-<family>-<version>`; priced set = `MODEL_PRICES` keys ∪ `settings.model_prices` keys; "newest" by comparing the version's numeric parts. Each suggestion's `what`, `evidence`, `effect` are one plain sentence each with the dollars (e.g. effect `"about $10 a week"`, `"about $30 once"`).
- [ ] **Step 4: Run** — PASS; G1 golden unchanged (no spend).
- [ ] **Step 5: Commit** `kit-173: T4 suggestions` via `gate test`.

## Rulings

- `m-20261115-203704194-supervisor`: plan ahead; build only after `kit-98` merges and approve-plan; briefs carry lessons k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule; only touched test files, `--test-concurrency=2`.
- `m-20261115-204118085-supervisor`: task first passes, option B (in Global Constraints and Task 1).
- Spec passes 2–3 changed the spec after this plan's first draft (one read per request across `reviewStats` and `reviewPasses`; exact-key pricing; rounding; plain-words texts); the plan follows the spec as of its latest approved pass.
