# kit-98-autonomy-score-data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- One new function, `autonomyData()`, in `docs/devteam/scripts/devteam.mjs`, called by `dashboardData()`. It adds `autonomy` (`decisions`, `trust` and `senses`) to `/api/data`.
- Each week's merged count, corrections and answers with the recommendation come from its stored learning record. This week, and any week since the log began with no record, use `learningFigures` computed on read. The split (alone, asked, corrected) and asked again, hours waiting and answers are counted from the log on read (ruling `m-20261115-224929460-supervisor`).
- `withLogAt` gets a fast path for a cut at or after the log's last line. Computed ended weeks are cached across requests, keyed by the week and the log's length and last `at`.
- `sensor discover` writes `run/sensor-discovery.json`, and Senses reads that file. Discovery never runs on a request.
- Three tasks, each with its own tests in `test/autonomy-data.test.mjs`: decisions and the 12 weeks, trust, senses. Each task re-records the G1 `dashboard-data.txt` golden, and only its `autonomy` block may move.
- Build starts once kit-173 and kit-87 have merged (kit-205 no longer ahead, m-20261115-225222263) and approve-plan is recorded. It reuses kit-173's week helper and is rebased onto its golden.
- Tests run one file at a time at `--test-concurrency=2`. CI is the gate.

**Goal:** `/api/data` carries `autonomy` exactly as `spec.md` defines it.

**Architecture:** The data is derived on read inside the kit's single script. Stored learning records are reused where they exist, and the extra figures are counted from the log. The only new store is a run-folder cache of discovery's result.

**Tech Stack:** Node (ESM), `node:test`, `test/lib/kit.mjs` (`fleetFixture`, `json`, `line`).

**Spec:** `docs/devteam-dev/tickets/kit-98-autonomy-score-data/spec.md` (this repo). The design is `docs/devteam/project/designs/a-cleaner-more-consistent-dashboard.md` › Autonomy pages › Trust (home).

## Global Constraints

- Touches only `docs/devteam/scripts/devteam.mjs`, `test/autonomy-data.test.mjs` and `test/fixtures/g1/dashboard-data.txt` (ruling `m-20261115-224310516-supervisor`).
- Weeks are 12 calendar weeks of `mondayOf` (Monday 00:00 UTC), oldest first, ending with this week. Each carries `starts_at` (ISO) and no ISO week name.
- `score` = round(100 × alone / decisions), and 0 when decisions is 0. `merged_per_answer` = merged ÷ max(1, answers) to 2 places. `with_recommendation.share` has 2 places and is 0 when `of` is 0. `hours_waiting` has 1 place. Every week field is a number, never null.
- Own authority means `rung`, `standing-rule` or `constitution`. `answer` and `default` are asked.
- Standing rules are owner-written knowledge of kind `preference` or with a scope starting `class:`, counted at `created_at` even if later retired.
- Working means a sensor state of `ok` (probe or stream) or `up` (http). Has means no declared credentials, a credential state of `posted`, or working.
- The cache file is `runPath('sensor-discovery.json')` = `{ at, sensors: [name], proposals: [name], missing: [name], outside: [name] }`. A missing or malformed file reads as no discovery (`discovered_at: null`).
- `metrics --json` and G1 `metrics.txt` don't change. No new dependency, log line, schema field or command flag.
- Code style is the file's own: dense one-liners where the neighbours are dense, and comments that say why.

## Review Focus

1. **A run just after Monday 00:00 UTC.** This week's fixture lines sit at `M + span × f` with `span = Date.now() − M` and 0 < f < 1, so they are in the past and inside this week. When `span` is under 10 minutes, the tests that need this week's events skip with the reason (`t.skip`). (Task 1 helper.)
2. **The server path, not only the CLI.** A running dashboard's `/api/data` carries the same `autonomy` as `dashboard-data`. A second request, made after a new decision line, sees it, so the cross-request cache drops entries when the log grows. (Task 1 test.)
3. **A stored record missing a figure** (hand-edited, or from an older kit): that figure reads 0, with no NaN and no throw. (Task 1 test.)
4. **No log lines in a week, and a log that began this week (G1):** 11 entries with every field 0. This week holds G1's counts. Nothing throws. (Task 1 golden plus a test.)
5. **A malformed `sensor-discovery.json`** (not JSON, or `proposals` not an array): read as no discovery, and senses still counts the sensors in place. (Task 3 test.)

---

### Task 1: Decisions, over 12 weeks (done-whens 1 decisions and 2)

**Files:**
- Modify `docs/devteam/scripts/devteam.mjs`: `withLogAt` (~9971); a new `autonomyWeek`, `autonomyDecisions` and `autonomyData` after `learningRecords` (~10080); `dashboardData` (~12046).
- Create `test/autonomy-data.test.mjs`.
- Modify `test/fixtures/g1/dashboard-data.txt`.

**Interfaces:**
- Consumes the 12-weeks helper. kit-173 lands `efficiencyWeeks(now)` → `[{ start, end }] ×12` (ms), so use it. If it isn't on main at build time, add `calendarWeeks(now)` with that exact shape and use that.
- Produces `withLogAt(cut, fn)`, unchanged in its contract, plus a fast path: when every line's `at` ≤ cut, it returns `fn()` with no refold and no reset of the globals.
- Produces `autonomyWeek(start)` → the spec's `<week>` object (ms start), memoized across requests in a module `Map` keyed `${start}\0${lines.length}\0${lastAt}`. The key covers computed ended weeks and this week; the map is cleared when the key's log part changes.
- Produces `autonomyData()` → `{ decisions: { score: { this_week, last_week }, this_week, last_week, weeks }, trust, senses }`. Task 2 fills `trust` and Task 3 fills `senses`; until then they are `null`.

The fixture's weeks: `M` = this Monday 00:00 UTC, week k starts at `W(k) = M − (11 − k) × WEEK`, and `h(k, d, hh)` = `W(k) + d days + hh hours`. Lines are hand-written, as `test/ooda-learning.test.mjs`' `handFor` writes them, with a counter in every id. The log's first line is in week 6.

| Week | Lines | Expected |
|---|---|---|
| 0–5 | none | every field 0, `record` null |
| 6 | decision `authority: 'rung'` | alone 1, decisions 1, score 100 |
| 7 | decision `rung`; a stored learning record (supervisor, `detector: 'metrics'`, `kind: 'learning'`, `week` = 7's name, `figures` with `trusted: { calls: 5, corrections: 1, agreed: 2, answered: 3 }`, `autonomous: { merged: 4 }`, the other columns `{}`), written in week 8 | `record` = its id, alone 1, corrected 1, decisions 2, score 50, merged 4, answers 0, merged_per_answer 4, with_recommendation `{ count: 2, of: 3, share: 0.67 }` |
| 8 | d1 decision `rung`; q1 owner-decision with recommendation `Yes`, asked h(8,1,10), answered `Yes` by the owner h(8,1,13); act a1 `approved_by` q1; q2 asked h(8,1,11) with a default, `status: 'defaulted'` h(8,1,16); act a2 `approved_by` q2; an owner hold on a goal; an owner `preference` (accepted); an owner `fact` (not a rule); d2 `rung`, corrected by the owner at h(9,1,0); d3 `rung`, corrected by the owner in week 8; q3 asked h(8,1,14) with `new_because`, withdrawn h(8,1,14.2); P asked h(8,1,12) with a pinned link `{ artifact: 'gone-page', at: 'main', sha256: 'ab…' }`, withdrawn h(8,1,12.5); Q asked h(8,1,13) with `new_because`, the same class, P's wording with one word changed, withdrawn h(8,1,13.2); an owner thread turn | alone 2 (d1, d2), asked 4 (q1, q2, hold, preference), corrected 1 (d3), decisions 7, score 29, answers 1, with_recommendation `{ count: 1, of: 1, share: 1 }`, asked_again 1 (q3; Q excluded), hours_waiting 6.0 |
| 9 | (d2's correction) | corrected 1, decisions 1, score 0 |
| 10 | q5 asked at `W(11) − 2h`, left open | hours_waiting 2.0, decisions 0, score 0 |
| 11 | d4 `rung` at `M + span × 0.5` | alone 1, score 100; hours_waiting is within [(tBefore − M)/3.6e6, (tAfter − M)/3.6e6] to 1 place; `lessons` = the ids of accepted knowledge in force (the week 8 preference and fact) |

- [ ] **Step 1: Write the failing tests.** Add the fixture helpers (`hand`, `W`, `h`, `span`) and these tests:
  - `twelve weeks, oldest first, ending this Monday`: `weeks.length === 12`; `weeks[11].starts_at === new Date(M).toISOString()`; each `starts_at` is 7 days after the one before.
  - `each week's decisions from the record and the log`: every row of the table above, field by field. `decisions.score` equals `{ this_week: 100, last_week: 0 }`. `this_week` and `last_week` deep-equal `weeks[11]` and `weeks[10]`.
  - `a stored record wins over a recompute`: week 7's corrected and merged come from the record (the log alone gives 0 for both).
  - `a stored record missing a figure reads 0`: in a second fixture, a record whose `trusted` lacks `agreed` gives `with_recommendation.count === 0` (Review Focus 3).
  - `a week with no decisions reads 0`: weeks 0–5 and week 10 have every field a number, and `score === 0`.
  - `the operator's words count nowhere`: run `operator-thread new "…"` with `HOME` set to the fixture's home. Then `dashboard-data` with the same `HOME` has the same `decisions.weeks` as before. (The owner thread turn in week 8 already shows a turn isn't a decision.)
  - `the server sees new lines` (Review Focus 2): start the dashboard as `test/dashboard.test.mjs` does. `GET /api/data` gives `autonomy` deep-equal to `dashboard-data`'s. Append decision d5 (`rung`) at `M + span × 0.6`. A second `GET` gives `weeks[11].alone === 2`.
- [ ] **Step 2: Run them to see them fail.** Command: `node --test --test-concurrency=2 test/autonomy-data.test.mjs`. Expected: FAIL, because `autonomy` is undefined.
- [ ] **Step 3: Add the `withLogAt` fast path and `autonomyWeek(start)`.** Its figures:
  - `R` = the stored record's `figures` (from `learningRecords()`, matched on `week === isoWeekOf(start)`). Otherwise, for this week or a week ending after the log's first line, `learningFigures(isoWeekOf(start)).figures`. Otherwise `{}`. A missing number reads 0 (`R?.trusted?.corrections ?? 0`).
  - `alone`: `calls()` with `created_at` in the week, authority (`authorityOfCall`) in the own-authority set, and no `correctionOf(c)` with `at` ≤ the week's end.
  - `asked`: owner answers plus defaulted questions (`answered_at` in the week); owner goal updates with a `decision`, `status` or `hold` (as `decisionRecords` reads them); owner standing rules.
  - `asked_again`: the spec's five conditions, with `nearlySameQuestion` and `artifactLinksMoved`.
  - `hours_waiting`: merge the `[asked_at, answered_at ?? now)` intervals of all questions, clip them to the week, and sum.
  - `lessons`: `learningFigures(...).lists.knowledge` for this week, `[]` otherwise.
  - `record`: the stored record's id or null.
- [ ] **Step 4: Add `autonomyData()` and wire it into `dashboardData()`** as `autonomy: autonomyData()`, after `ooda`.
- [ ] **Step 5: Run the tests to see them pass.** The same command. Expected: PASS (the week-11 tests may skip under Review Focus 1, with their reason printed).
- [ ] **Step 6: Re-record G1.** Generate it the way `test/components.test.mjs` does (its `g1Outputs` re-record path; read the file's header comment for the update switch). Check that `git diff test/fixtures/g1/` adds only the `autonomy` block under `dashboard-data`, then run `node --test --test-concurrency=2 test/components.test.mjs`. Expected: PASS.
- [ ] **Step 7: Commit** `devteam.mjs`, the test and the golden as `kit-98: task 1, decisions over 12 weeks`.

### Task 2: Trust (done-when 1 trust)

**Files:** modify `docs/devteam/scripts/devteam.mjs` (`autonomyTrust`, next to `autonomyData`), `test/autonomy-data.test.mjs` and `test/fixtures/g1/dashboard-data.txt`.

**Interfaces:**
- Consumes `ladder()`, `rungFor(cls)`, `rungHistory(cls)` and `releasesOnMerge()`.
- Produces `autonomyTrust(now)` → `{ own, kinds, raised, dropped, changes: [{ class, from, to, at, id }] }`, in `autonomy.trust`.

- [ ] **Step 1: Write the failing test** `trust: kinds on its own, and this week's moves`. In a fresh fixture, pick from `trust --json` a class X with `start < 3 ≤ ceiling` and a class Y.
  - At h(9,…): an owner trust answer raising Y to 2 (an earlier week's move, not counted).
  - At `M + span × 0.3`: an owner `trust` question about X answered with `autonomy: { class: X, rung: 3 }`.
  - At `M + span × 0.5`: a decision in Y (`rung`), corrected by the owner at `M + span × 0.6` (a drop to 1).

  Assert `raised === 1`, `dropped === 1`, and `changes` = `[{ class: X, from: start(X), to: 3 }, { class: Y, from: 2, to: 1 }]` with their `at` and `id`. Assert `kinds === trust --json`'s row count and `own ===` its count of rows with `rung === 3`.
- [ ] **Step 2: Run it to see it fail.** The same command. Expected: FAIL (`trust` is null).
- [ ] **Step 3: Implement `autonomyTrust`.** Walk each class's `rungHistory` from the capped `def.start`. Cap each step as `rungFor` caps (`min(r, ceiling)`, and for `incident-fix` with `releasesOnMerge()`, `min(r, max(2, rungFor('release-production')))`). Count an event dated in this week as a change when the effective rung differs from the one before.
- [ ] **Step 4: Run it to see it pass.** The same command. Expected: PASS.
- [ ] **Step 5: Re-record G1, check the diff, and run `test/components.test.mjs`,** as in Task 1 Step 6.
- [ ] **Step 6: Commit** as `kit-98: task 2, trust`.

### Task 3: Senses (done-when 1 senses)

**Files:** modify `docs/devteam/scripts/devteam.mjs` (`cmdSensor`'s `discover` branch, ~18790; `autonomySenses` next to `autonomyData`), `test/autonomy-data.test.mjs` and `test/fixtures/g1/dashboard-data.txt`.

**Interfaces:**
- Produces, in `sensor discover` (every mode, before printing), a write of the cache file. `outside` is `d.outside.proposals.map((p) => p.name ?? p.sensor?.name ?? p).filter(isStr)` when `d.outside?.proposals` is an array, else `[]`. Use `fs.writeFileSync` with `{ recursive }` mkdir. A failed write doesn't fail the command.
- Produces `autonomySenses()` → `{ needed, has, working, missing, names: { needed, has, working }, discovered_at }`, in `autonomy.senses`. Names are sorted.

- [ ] **Step 1: Write the failing tests.**
  - `senses: needed, has, working and the missing named`. Settings (edited and committed as `monoFixture`'s `edit` does) hold `web` (http, no credentials), `tok` (probe, `credentials: { TOK: 'file:tok' }`) and `fake` (probe, credentials). The state files `run/sensors/<name>/state.json` say `web` `{ state: 'up' }`, `tok` `{ state: 'ok' }` and `fake` `{ state: 'failing' }`. A committed `package.json` has `{"dependencies":{"@sentry/node":"1"}}`.
    - Run `sensor discover --json`. The cache exists, with `missing` ⊇ `['sentry']` and `proposals` ⊇ `['sentry']`.
    - Rewrite the cache's `outside` to `['page-views']`.
    - Assert `names.needed = ['fake', 'page-views', 'sentry', 'tok', 'web']`, `names.has = ['tok', 'web']`, `names.working = ['tok', 'web']` and `missing = ['fake', 'page-views', 'sentry']`. Assert `needed ≥ has` (ruling `m-20261115-224929460-supervisor`) and `discovered_at === cache.at`.
  - `senses with no discovery, or a malformed one` (Review Focus 5). With no cache, `needed` counts only the sensors in place and `discovered_at === null`. With the cache file holding `not json`, the result is the same.
- [ ] **Step 2: Run them to see them fail.** The same command. Expected: FAIL (`senses` is null).
- [ ] **Step 3: Implement the cache write and `autonomySenses`,** reading the sensors from `sensorStatus()` (state, credentials) and the credential state from `sensorCredentialState`.
- [ ] **Step 4: Run them to see them pass.** The same command. Expected: PASS.
- [ ] **Step 5: Re-record G1, check that only `autonomy.senses` moved, and run `test/components.test.mjs`.**
- [ ] **Step 6: Commit** as `kit-98: task 3, senses`.

## Rulings

- `m-20261115-224310516-supervisor`: the G1 golden is in touches; rebase onto kit-173's version once it merges.
- `m-20261115-224929460-supervisor`: needed = sensors in place, proposals, missing and outside, with needed ≥ has tested. The split is counted from the log; merged, corrections and with-recommendation come from the stored record.
- Trial `a-20261115-214153204-supervisor`: review rounds are capped. After a second round, Minor findings are fixed and disposed with no further pass, and a third pass only confirms a Critical or Important fix.
- Shell rules for every subagent brief: multi-step shell goes in a script file; `rm -rf` only on guarded paths; scratch is a private `mktemp -d`; no `/dev/zero`; `timeout` on everything. Only the touched test files run, at `--test-concurrency=2`.
