# kit-242-awareness-data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- Code changes are all in `docs/devteam/scripts/devteam.mjs`, and the new tests are all in `test/awareness-data.test.mjs`. The G1 golden `test/fixtures/g1/dashboard-data.txt` gains only the two new blocks.
- **Task 1 (no behaviour change).** It factors `learningFigures`' signal grouping into `recurringGroups()`, which also gives each group its formed time, and splits `fixedIncidents(now)` out of `incidentDebt(now)`. It also gives `orientationDebt(now)` and `efficiencyData(m, now)` an optional `now`, moves the id rule into a marked `suggestionId` block, and makes `dashboardDataRead` read the clock once. The G1 goldens don't move. `ooda.debt` still reads `Date.now()`.
- **Task 2.** `awarenessData(now)` gives each of the 12 weeks its four parts and a score. Each week is computed inside `withLogAt(E)` (E = min(week end, now)), and weeks that end before the log's first line are skipped. Explanation times come from the citing records' first line that carries the item, and from noise rulings made at or after the first sighting.
- **Task 3.** It adds up to five suggestions (incidents, then the lessons suggestion, then signals) with safe, de-duplicated `aw-` ids.
- **Task 4.** It adds `autonomy_score`, the rounded mean of trust, efficiency and awareness, null if any is null. It re-records the G1 golden, checks the server path and that every block's `starts_at` lines up, and times one request on the home log.
- **Tests and risks.**
  - One hand-written fixture with every case and its hand-computed answers (the table below). Tests run one file at a time at `--test-concurrency=2`, and CI is the gate.
  - Risks: ties in time order, a Monday-boundary run (the tests skip within 10 minutes of it), and cost (up to 11 folds per request).

**Goal:** `/api/data` carries `awareness` and `autonomy_score` exactly as `spec.md` defines them.

**Architecture:** Everything is derived on read inside the kit's single script, using the same 12 weeks as `efficiency` and `autonomy`. Past weeks re-fold the log at their end, and this week reads the log as it is now.

**Tech Stack:** Node (ESM), `node:test`, `test/lib/kit.mjs` (`fleetFixture`, `json`, `line`, `write`, `dashboardOnFreePort`), `node:vm` for the id block.

**Spec:** `docs/devteam-dev/tickets/kit-242-awareness-data/spec.md` (approved at c2888776, ruling `m-20261117-132827328-supervisor`).

## Global Constraints

- Touches only `docs/devteam/scripts/devteam.mjs`, `test/awareness-data.test.mjs` and `test/fixtures/g1/dashboard-data.txt`.
- `share` = count / of, rounded to 2 places; null when of = 0. `starts.share` is also null with no knowledge in force at E. `score` = round(100 × the mean of the unrounded non-null shares); null when every share is null.
- E = min(the week's start + WEEK − 1 ms, now). The 28-day window is `(E − 28 d, E]`. The incidents window is `incidentDebt`'s (resolved within 30 days of `now`).
- Ids: `suggestionId(prefix, kind, subject)` = `${prefix}-${kind}-${subject}`, lower-cased, every character outside `[a-z0-9-]` replaced by `-`, cut to 110. On a clash the id is `base.slice(0, 110 − suffix.length) + suffix`, with suffix `-2`, `-3`, and so on. A suffixed id is checked against every id taken so far.
- Suggestion words exactly as in spec.md › Suggestions. They name no command, no function, and none of the words Informed, Orient or debt (strategy R2).
- No log line, schema field, command, flag or setting changes. `metrics.txt` and every golden other than `dashboard-data.txt` stay byte-identical.
- Code style is the file's own: dense where its neighbours are dense, and comments say why.
- No full suite on the box: run `node --test --test-concurrency=2 <file>` for the touched files only, with `env -u TMUX`.

## Review Focus

1. **Equal timestamps.** Two items or two signals can share an `at`. Sort by `at` and then by `id`, so forming and the "oldest first" order are deterministic. Task 2 and Task 3 build their fixtures with the per-signal minute offsets below, and the order test pins the order.
2. **A hand line the fold ignored** (a `set` from a writer below the field's rank). Read later citation times from the object's `updates`, which hold applied changes only, never from raw `set` lines. The one raw line read is the `new` line the fold kept (P1-6, P2-3). Task 2's dropped-citation cases use applied sets.
3. **A run within 10 minutes after Monday 00:00 UTC.** This week's lines need room. The tests that read week 11 skip with `TOO_SOON`, as `test/autonomy-data.test.mjs` does (Task 2).
4. **A stored learning record for a week.** Awareness ignores it, because it needs times the record doesn't hold. A test writes a record with different `informed` figures for week 7 and shows awareness still reads the log (Task 2).
5. **A big log.** One `/api/data` request on home's log (about 15k lines) is timed before and after the change, and both numbers go in verification.md (Task 4). A rise of more than 3 s goes to the supervisor before the merge-request.

## The fixture (`awarenessFixture`, used by Tasks 1 to 4)

Clock: `M` = this Monday 00:00 UTC; `W(k)` = M − (11 − k) × WEEK; `h(k, d, hh)` = W(k) + d days + hh hours; `E(k)` = W(k + 1) − 1 ms for k < 11. Lines are written with `handFor` as in `test/autonomy-data.test.mjs` (copy it), with two changes. Its prefix map gains `problem: 'p'`: without it a problem's id reads `undefined-…` and `readLog` drops the line (P1-4). And `hand(by, o, ms, { exact: true })` writes at exactly `ms`, with no counter milliseconds, for the edge-time lines `sA`, `sB` and `sC`: the counter's up to 999 ms would push `sA` past E(2) (P1-3). `S` = `supervisor`, `O` = `owner`. Observations are `{ type: 'observation', kind: 'note', subject: 'app', source_key: <key>, detail: '<key> sighting <n>', valence: -1 }`.

**Efficiency weeks** (for Task 4). Copy `effFixture`'s `shipped` and `land` from `test/efficiency-data.test.mjs` together with what they use: its own `hand` (prefixes `phase: 'h'` and `spend: 's'`), `addTicket`, `phase`, `spend`, `merge`, `mergeAt` and the `eff` feature line. Never wire them to `handFor`, whose prefix map has no `phase` or `spend`, so their ids would read `undefined-…` and be dropped (P2-1). three tickets shipped in week 0 and three in week 7. Each ticket is size S, `hours: 1`, with one build spend of $1 (input 100, output 50). Weeks 0 and 7 then both score 100 for efficiency, and every other week is null.

**Signals.** Each signal j has items at F_j − 2 h (S), F_j − 1 h (S) and F_j (O), with F_j = h(8, 1, 11) + j minutes, so its group forms at F_j. `oX` is one observation on key `other:x` at h(8, 0, 1). Every noise ruling is `{ type: 'decision', class: 'orient-noise', authority: 'constitution', what: 'noise', refs: [<key>, oX] }`, except `sig:k`'s. `orient-noise` is constitutional, so only `constitution` is live (P1-1). Knowledge's `evidence` can't be set after its new line (`x-authority`), so every case that changes a citation later uses a problem with no fingerprints, `{ type: 'problem', title, severity: 1, realized: true, status: 'open', refs }` by S, whose `refs` the supervisor may set (P1-2). "k-cand" means knowledge `{ kind: 'lesson', status: 'candidate', statement: '…', scope: 'project' }` by S, which is not in force.

| j | key | explanation | week 8 |
|---|---|---|---|
| 0 | sig:a | k-cand cites item 3 at F+3h | counts |
| 1 | sig:b | k-cand cites item 1 at F+30h | in `of`, not counted |
| 2 | sig:c | ruling at F+2h | counts (fails if the ruling rule is dropped) |
| 3 | sig:d | k-cand cites item 1 at F−1.5h | counts, 0 h |
| 4 | sig:e | k-cand cites item 1 at F+40h; a problem (no fingerprints) new at F+0.5h with `refs: []`, set `refs: [item 2]` at F+2h | counts (the earliest) |
| 5 | sig:f | problem new at F+1h `refs: [item 1]`, set `refs: [item 1, item 2]` at F+40h | counts (a later line doesn't move it) |
| 6 | sig:g | decision `orient-noise`, `constitution`, `refs: [item 1]` (no key, so only the citation path) at F+1h; owner `corrected` at F+5h | not explained (live until corrected, so the correction is what flips it, P1-5) |
| 7 | sig:h | problem new at F+1h `refs: [item 1]`; set `refs: []` at h(8,4,0) | not explained (dropped before E) |
| 8 | sig:h2 | problem new at F+1h `refs: [item 1]`; set `refs: []` at h(9,1,0) | counts (dropped after E) |
| 9 | sig:i | ruling at F−0.5h (after the 2nd sighting, before the 3rd) | counts, 0 h (fails with spec-2's from-forming limit) |
| 10 | sig:j | ruling at F+30h | not within a day |
| 11 | sig:k | ruling `refs: ['sig:k']` only, at F+1h | not explained (key-only) |
| 12 | sig:m | ruling at F−3h (before the 1st sighting) | not explained (fails with no lower limit) |
| 13 | sig:q | problem new at F+1h `refs: []`, set `refs: [item 1]` at F+30h | not within a day (fails if a citation added by an update is dated at the record's creation, P1-6) |
| — | sig:l | items at E(8)−20h (S), −19h (S), −18h (O); none | left out of `of` (formed in the last day) |
| — | sig:n | items at E(8)−10h (S), −9h (S), −8h (O); k-cand cites item 1 at E(8)−5h | counts |
| — | sig:solo | three items by S at h(8,2,1), (8,2,2), (8,2,3) | never forms |
| — | sig:p | items at h(7,1,9) S, h(7,1,10) S, h(7,1,11) O; k-cand cites item 1 at h(7,1,12) | week 7: counts |

Week 8 signals: of 15 (j0 to j13 and sig:n), count 8 (a, c, d, e, f, h2, i, n), share 0.53.

**Incidents.** Each is `{ type: 'problem', title, severity: 2, realized: true, status: 'open', fingerprints: ['fp-<name>'] }` by S. It is set to `status: 'resolved'` (by S, unless stated), and verified by an `{ kind: 'outcome', valence: 1, refs: [p] }` observation.
- `inc5`: new h(5,1,0), resolved h(5,2,0), verified h(5,3,0); no lesson.
- `incL`: new h(6,1,0), resolved h(6,2,0), verified h(6,2,5); k-cand with `evidence: [incL]` at h(6,3,0).
- `incO`: new h(6,1,1); the **owner** sets resolved at h(6,2,1); verified h(6,2,6). Left out.
- `incU`: new h(6,1,2), resolved h(6,2,2); outcome valence 0. Not verified, left out.
- `incF`: title "the hub outage"; new h(10,1,0), resolved h(10,2,0), verified h(10,2,5); no lesson.

**Lessons and starts.**
- `k1` (accepted lesson by O) at h(2,0,0), `k2` (accepted fact by O) at h(2,0,1), `k3` (accepted lesson by O) at h(9,0,0).
- A start is `{ type: 'act', class: 'worker-slots', what: 'made worker t<n> in s:t<n>', refs: ['t<n>'], knowledge?: [...] }` by S:
  - `s0` at h(1,1,0), no knowledge;
  - `sC` [k1] at E(6) − 29 d;
  - `sA` [k1] at E(6) − 28 d exactly;
  - `sB` [k2] at E(6) − 28 d + 60 s;
  - `sD` [k1] at h(10,1,0);
  - `s5` at h(10,1,1), no knowledge.
- **Trust in week 7:** one decision `priority-change`, `rung`, at h(7,4,0).
- **A stored record:** a learning record for week 7 (as kit-98's fixture writes it) with `figures: { informed: { knowledge: 9, signals_explained: 9, signals_formed: 9, starts_given: 9, starts: 9 }, autonomous: {}, trusted: {} }` (all three columns objects, so `learningRecords` reads it; its missing trusted figures read 0, so week 7's trust score stays 100), written at h(8,5,9).

**Expected `awareness.weeks`** (shares; `—` is null; `[c/o]` gives count and of):

| wk | signals | incidents | lessons | starts | score |
|---|---|---|---|---|---|
| 0 | — [0/0] | — | — | — | null |
| 1 | — | — | — [0/0] | — [0/1] (no knowledge) | null |
| 2 | — | — | 0.5 [1/2] | 1 [2/2] (sC, sA) | 75 |
| 3 | — | — | 1 [2/2] | 1 [1/1] (sB) | 100 |
| 4 | — | — | 1 [2/2] | — [0/0] | 100 |
| 5 | — | 0 [0/1] | 1 [2/2] | — | 50 |
| 6 | — | 0.5 [1/2] | 0.5 [1/2] (sA excluded at exactly 28 d) | — | 50 |
| 7 | 1 [1/1] | 0.5 [1/2] | 0 [0/2] | — | 50 |
| 8 | 0.53 [8/15] | 0.5 [1/2] | 0 [0/2] | — | 34 |
| 9 | — | 1 [1/1] (inc5 > 30 d) | 0 [0/3] | — | 50 |
| 10 | — | 0 [0/1] (incL > 30 d) | 0.33 [1/3] | 0.5 [1/2] | 28 |
| 11 | — | 0 [0/1] | 0.33 [1/3] | — [0/0] | 17 |

Week 5 reads `0 of 1` only because the clock is E. With `Date.now()` the incident is over 30 days old, so the week would read null. The table above is the oracle. Compute any row the build disputes by hand again, and fix the table with the supervisor's word, never the code to fit it.

**Expected `autonomy_score`:**
- Week 7 = round((100 + 100 + 50) / 3) = **83**.
- Week 0 is null: awareness is null there, while efficiency is 100.
- Weeks 8 and 11 are null: efficiency is null there.
- `this_week` is null, and `last_week` is `weeks[10].score` (null).

**Expected `awareness.suggestions`:**
1. `aw-incident-<incF id>`: "Write down what the hub outage taught" / "Fixed <n> days ago and verified since; no lesson cites it" / "Fixed incidents that left a lesson: 0 of 1 → 1 of 1".
2. `aw-lessons-unused`: "Look at the 2 lessons no session was given in 4 weeks" / "2 of 3 lessons in force reached no session start in the last 28 days" / "Lessons sessions use: 1 of 3 → 1 of 1 once those are retired".
3. to 5. `aw-signal-sig-g`, `aw-signal-sig-h`, `aw-signal-sig-h2`: "Find out what keeps causing this: sig:g sighting 3" (and so on) / "Seen 3 times since <first_at date>, unexplained" / "First seen <d> days ago; explaining it stops further sightings piling up".

`ooda.debt.signals` lists g, h, h2, k, m, l in that order, so the suggestions are cut at five.

---

### Task 1: Shared helpers, no behaviour change

Model: strong

**Files:**
- Modify `docs/devteam/scripts/devteam.mjs`:
  - `orientationDebt` (10556) and `incidentDebt` (10566);
  - `learningFigures` (10616);
  - `effId` (12302) and `efficiencyData` (12368);
  - `dashboardDataRead` (13155).
- Create `test/awareness-data.test.mjs`: the fixture helpers and the fixture above, built once per test file as a function.

**Interfaces (produces):**
- `recurringGroups()` → `Map<key, { key, items: [{ id, at, who }] (sorted by at, then id), formed_at: string | null }>`. It covers every observation except the kinds `reading`, `retro`, `outcome`, `link` and `learning`, plus the corrections, as `learningFigures` groups them today. `formed_at` is the `at` of the first item j ≥ 2 where items `0..j` come from two writers or fall on two days, and null when no such item exists. `learningFigures`' `signals` become the groups with `formed_at`, and its output is unchanged.
- `fixedIncidents(now = Date.now())` → `[{ p, resolved_at, outcome }]`, oldest first. These are incidentDebt's tests before its lesson filter.
- `incidentDebt(now = Date.now())`: rows exactly as today.
- `orientationDebt(now = Date.now())`: rows exactly as today.
- `/* suggestion ids start */ … /* suggestion ids end */` holds:
  - `suggestionId(prefix, kind, subject)`;
  - `uniqueIds()` → `(id) => string`: a closure that de-duplicates by the global rule;
  - `effId = (k, s) => suggestionId('eff', k, s)`.
- `efficiencyData(m, now = Date.now())` uses `efficiencyWeeks(now)` and `start/end` from it.
- `dashboardDataRead` sets `const now = Date.now()` once and passes it to `efficiencyData(metrics, now)` and `autonomyData(now)`.

- [ ] **Step 1: Write the failing tests** in `test/awareness-data.test.mjs`:
  - `suggestion ids: the shared rule, unchanged for efficiency`. Load the marked block with `vm` (as `coverageFns` in `test/lib/kit.mjs` does). Then check:
    - `effId('tighter-specs', 'spec') === 'eff-tighter-specs-spec'`;
    - `suggestionId('aw', 'signal', 'Dup:Z/x') === 'aw-signal-dup-z-x'`;
    - a 200-character subject gives length 110;
    - with `const u = uniqueIds()`: `u('aw-signal-dup-z') === 'aw-signal-dup-z'`, then `u('aw-signal-dup-z') === 'aw-signal-dup-z-2'`, then `'…-3'`;
    - a 110-character id's second use is 110 long and ends `-2`;
    - if `'x-2'` was taken first, `u('x')`, `u('x')` gives `'x'` and then `'x-3'`.
  - `other callers read the clock as before`. The full fixture is built. `dashboard-data`'s `ooda.debt.incidents` lists exactly `[incF]`, whose `days` lies between `floor((tBefore − h(10,2,0)) / DAY)` and `floor((tAfter − h(10,2,0)) / DAY)`. `ooda.debt.signals` keys are `['sig:g', 'sig:h', 'sig:h2', 'sig:k', 'sig:m', 'sig:l']`, each `hours` within the same now-bounds from its `first_at`. `orient`'s text names `incF`.
- [ ] **Step 2: Run them.** Command: `env -u TMUX node --test --test-concurrency=2 test/awareness-data.test.mjs`. Expected: the id test fails (no marked block yet), and the other-callers test passes (it is a guard).
- [ ] **Step 3: Implement** the interfaces above. `learningFigures` calls `recurringGroups()` inside its own `withLogAt`.
- [ ] **Step 4: Run** `test/awareness-data.test.mjs`, `test/ooda-learning.test.mjs`, `test/efficiency-data.test.mjs`, `test/autonomy-data.test.mjs` and `test/components.test.mjs`, one at a time at `--test-concurrency=2` under `env -u TMUX`. Expected: all pass, with the G1 goldens unchanged and `git diff test/fixtures` empty.
- [ ] **Step 5: Commit** `kit-242: task 1, shared helpers (no behaviour change)`. Task review: `reviews/task-1.md`.

### Task 2: The four parts and the score, for 12 weeks

Model: strong

**Files:** `docs/devteam/scripts/devteam.mjs` (a new `awarenessWeek` and `awarenessData` after `autonomyData`, ~10808; `dashboardDataRead`) and `test/awareness-data.test.mjs`.

**Interfaces:**
- Consumes `recurringGroups`, `fixedIncidents`, `incidentDebt`, `efficiencyWeeks`, `withLogAt`, `liveDecision`, `correctionOf`.
- Produces `awarenessWeek(start, now, firstMs)` → `{ starts_at, score, parts, E }`, where `E` is internal and is dropped before serving.
- Produces `awarenessData(now = Date.now())` → `{ score: { this_week, last_week }, parts, weeks, suggestions: [] }`. Task 3 fills `suggestions`.
- `dashboardDataRead` adds `awareness: awarenessData(now)` right after `efficiency`.

The algorithm for one week:
- If E < the log's first line, return the empty parts with no `withLogAt`.
- Otherwise, inside `withLogAt(new Date(E).toISOString(), …)`:
  - **signals.** Take the groups with `formed_at` in `[S, E]`. Citation times: for each knowledge or problem object, and each live decision with an `o-` ref, walk its new line and then its applied updates in order. The folded object keeps only current values, so the new line's `evidence` and `refs` come from the log's first `op: 'new'` line with that id (the one the fold kept). The updates are `obj.updates`, applied changes only (P1-6). Each item gets the `at` of the first entry carrying it, counted only if the object's current `evidence ∪ refs` still carries it. Ruling times: live `orient-noise` decisions with an `o-` ref whose refs name the key, counted only if `created_at ≥ items[0].at`. `x` is the minimum of these. The signal is in `of` unless `formed_at > E − 24 h` and it has no `x`. It is counted when `x − formed ≤ 24 h`.
  - **incidents.** `of` = `fixedIncidents(E).length`, and `count` = `of − incidentDebt(E).length`.
  - **lessons.** The accepted knowledge ids, and the starts (`worker-slots`, `what` starting `made `) in `(E − 28 d, E]`.
  - **starts.** The starts in `[S, E]` that have knowledge.

- [ ] **Step 1: Write the failing tests:**
  - `awareness: twelve weeks, oldest first, ending this Monday`: 12 entries; `weeks[11].starts_at === M`; 7-day steps.
  - `awareness: each week's parts and score, read at its end`: every cell of the expected table, as `{ count, of, share }`, plus `score`. `score.this_week` and `score.last_week` are 17 and 28. `parts` deep-equals `weeks[11].parts`. Skip under `TOO_SOON`.
  - `awareness: a stored learning record doesn't stand in for the log`: week 7 still reads as in the table despite the record's 9s (Review Focus 4).
  - `awareness: a week before the log is not folded`: a second fixture whose lines are all in week 11, at `M + span × f`, so the test skips under `TOO_SOON` (P1-10). It has four accepted lessons by O, and one start by S that gives three of them. Weeks 0 to 10 are all `{ count: 0, of: 0, share: null }` with score null. Week 11's lessons read `3/4` and its starts `1/1`. Task 3 adds this fixture's suggestion.
- [ ] **Step 2: Run** `env -u TMUX node --test --test-concurrency=2 test/awareness-data.test.mjs`. Expected: FAIL, because `awareness` is undefined.
- [ ] **Step 3: Implement** `awarenessWeek` and `awarenessData`. Sort ties by `at`, then `id` (Review Focus 1). Take the later citations from `updates`, never from raw `set` lines; read only the kept `new` line raw (Review Focus 2).
- [ ] **Step 4: Run** the new file, then `test/components.test.mjs`. Expected: the new file passes. G1 fails only on `dashboard-data.txt`, for the new `awareness` block: re-record it with `DEVTEAM_G1_RECORD=1`, check that `git diff test/fixtures` shows only that block, and rerun the file.
- [ ] **Step 5: Commit** `kit-242: task 2, awareness parts and score`. Task review: `reviews/task-2.md`.

### Task 3: Suggestions

Model: strong

**Files:** `docs/devteam/scripts/devteam.mjs` (`awarenessData`) and `test/awareness-data.test.mjs`.

**Interfaces:** consumes `uniqueIds`, `suggestionId`, `incidentDebt(now)`, `orientationDebt(now)` and this week's lessons part (Task 2). Produces `awareness.suggestions: [{ id, kind, what, evidence, effect }]`, at most five.

- The words are exactly as in spec.md › Suggestions, with the singulars: "the lesson", "lesson in force", "once it is retired", "Fixed today", "1 day ago" and "1 day".
- The detail is cut to 120 characters. With no detail, the text reads "Find out why this keeps happening (<count> times)".
- `<date>` is `first_at`'s `YYYY-MM-DD`. `d` = max(1, floor(hours / 24)).

- [ ] **Step 1: Write the failing tests:**
  - `awareness: suggestions, in order and cut at five`: the main fixture's list deep-equals the expected five. `<n>`, `<d>` and the date are computed from the fixture's times with now-bounds, as in Task 1.
  - `awareness: exactly a quarter unused gets the lessons suggestion, in the singular`: the second fixture (Task 2) gives exactly `aw-lessons-unused`, with "Look at the lesson no session was given in 4 weeks" / "1 of 4 lessons in force reached no session start in the last 28 days" / "Lessons sessions use: 3 of 4 → 3 of 3 once it is retired". Changing the threshold from ≥ to > drops it (P1-7).
  - `awareness: clashing ids, singular words, and no lessons suggestion under a quarter`: a third fixture with:
    - five accepted lessons, four of them given to a start 2 days ago (1 of 5 unused, under a quarter: no lessons suggestion, P1-7);
    - incident `incY`, resolved at now − 36 h and verified at now − 35 h ("Fixed 1 day ago"), and incident `incT`, resolved at now − 1 h and verified at now − 0.5 h ("Fixed today");
    - signals on `dup:z` (first sighting at h(9,1,9), its last detail over 120 characters) and `dup/z` (h(9,1,10)), each formed by three items from S and O and unexplained;
    - a signal on `quiet:x` with empty details, its items at now − 30 h (S), −29 h (S) and −28 h (O).

    This fixture's lines are dated from now, not from Monday: "Fixed today" and "1 day ago" depend on the time since now, and dating them from Monday would break them on a Monday run. This is the one exception to the spec's Monday dating, and it is safe because nothing in this fixture depends on which week a line falls in (P2-2).

    Expected, in order: `aw-incident-<incY>`, `aw-incident-<incT>`, `aw-signal-dup-z` (its `what` cut to 120 characters of detail), `aw-signal-dup-z-2`, and `aw-signal-quiet-x`, whose `what` is "Find out why this keeps happening (3 times)" and whose `effect` is "First seen 1 day ago; explaining it stops further sightings piling up" (P1-8).
  - `awareness: plain words`: no suggestion's text matches `/informed|orient|debt|devteam|--/i` (R2).
- [ ] **Step 2: Run** the file. Expected: FAIL (`suggestions` is `[]`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and `test/components.test.mjs`. Re-record G1 if only `awareness.suggestions` moved, check the diff against the G1 expectations below, and rerun.
- [ ] **Step 5: Commit** `kit-242: task 3, awareness suggestions`. Task review: `reviews/task-3.md`.

### Task 4: The Autonomy Score, the server path, and cost

Model: fast

**Files:** `docs/devteam/scripts/devteam.mjs` (`dashboardDataRead`), `test/awareness-data.test.mjs` and `test/fixtures/g1/dashboard-data.txt`.

**Interfaces:** produces `autonomyScore(autonomy, efficiency, awareness)` → `{ this_week, last_week, weeks: [{ starts_at, score }] }`. Each `score` is `Math.round((t + e + a) / 3)` when all three are numbers, else null. `dashboardDataRead` adds `autonomy_score` right after `autonomy`.

- [ ] **Step 1: Write the failing tests:**
  - `autonomy score: the mean of the three, null when any is`:
    - `weeks[7].score === 83`, written by hand, and also equal to the formula over the payload;
    - `weeks[0].score === null` (awareness null), and `weeks[8]` and `weeks[11]` null (efficiency null);
    - `this_week` and `last_week` equal `weeks[11].score` and `weeks[10].score`.
  - `one clock: every block's weeks line up`: for every i, `awareness.weeks[i].starts_at`, `autonomy_score.weeks[i].starts_at`, `efficiency.weeks[i].starts_at` and `autonomy.decisions.weeks[i].starts_at` are equal.
  - `the server serves the same awareness and autonomy_score`: start the dashboard as `test/autonomy-data.test.mjs` does. `GET /api/data` gives the same `awareness`, compared without `effect` and `evidence` (they carry day counts), and the same `autonomy_score` as `dashboard-data`.
- [ ] **Step 2: Run.** Expected: FAIL, because `autonomy_score` is undefined.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file and `test/components.test.mjs`. Re-record G1, which should add only `autonomy_score` with all-null scores. Check that `git diff test/fixtures` holds only the `awareness` and `autonomy_score` blocks, and rerun. Time `node docs/devteam/scripts/devteam.mjs dashboard-data > /dev/null` in home (`/data/home/code/devteam-dev`), once with main's script and once with this branch's script run against home (`DEVTEAM_HOME` unchanged). Record both numbers for verification.md (Review Focus 5).
- [ ] **Step 5: Commit** `kit-242: task 4, autonomy score and the server path`. Task review: `reviews/task-4.md`.

## What G1 holds (P1-9)

G1's log begins at run time, this week, with one accepted fact and the `slow:g1` signal: three sightings from two writers, formed under a day ago and unexplained. It has no start and no incident. So the re-recorded `dashboard-data.txt` gains exactly:
- `awareness.weeks[0..10]`: every part `{ count: 0, of: 0, share: null }`, score null.
- `weeks[11]`: signals `[0/0]` null, incidents `[0/0]` null, lessons `{ count: 0, of: 1, share: 0 }`, starts `[0/0]` null, score 0.
- `score` `{ this_week: 0, last_week: null }`, and `parts` = `weeks[11].parts`.
- `suggestions`: one, `aw-lessons-unused`, "Look at the lesson no session was given in 4 weeks" / "1 of 1 lesson in force reached no session start in the last 28 days" / "Lessons sessions use: 0 of 1 → 0 of 0 once it is retired".
- `autonomy_score`: every week's score null, and `this_week` and `last_week` null.
- The `starts_at` keys are stripped by G1's timeless filter.

Any other difference in the golden is a defect to fix, not to record.

## Done-when → test map

| Done-when | Tests |
|---|---|
| 1 (the parts, 12 weeks, at E) | Task 2: weeks; parts and score; stored record; before the log. Task 1: other callers. |
| 2 (suggestions; other callers unchanged) | Task 3: order and cut; clashing ids; plain words. Task 1: ids; other callers. |
| 3 (autonomy_score) | Task 4: the mean; one clock; server. |
| G1 (spec check 4) | `test/components.test.mjs` with the re-recorded golden; `metrics.txt` unchanged. |
