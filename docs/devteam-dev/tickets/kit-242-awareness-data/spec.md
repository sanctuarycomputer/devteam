# kit-242-awareness-data: spec

The Awareness Score's data and the Autonomy Score. Each of the last 12 weeks gets four plain parts and a score. This week gets up to five suggestions. Each week also gets the mean of the three scores. Feature `dashboard-cleanup`, stories DCL-S7 and DCL-S14. Design: `project/designs/a-cleaner-more-consistent-dashboard.md` (home), Autonomy pages › Awareness and Overview › Autonomy (owner, threads `t-20261115-204212902-owner` and `t-20261115-233023839-owner`; rulings `m-20261115-204255095-supervisor` and `m-20261115-204259693-supervisor`). This ticket computes `/api/data` `awareness` and `autonomy_score` on read. `kit-93` draws the Awareness page and `kit-90` draws the Overview's Autonomy row. Nothing new is stored.

## Why

The owner found the Loop page's "Informed" panel confusing (thread `t-20261115-204212902-owner`). It moves to its own Autonomy page, Awareness: one score for how well the fleet understands what happens to it. The score is built from four parts in plain words, has a 12-week line, and comes with a short list of things to do. The Overview's Autonomy row leads with the Autonomy Score, which is the mean of Trust, Efficiency and Awareness (thread `t-20261115-233023839-owner`). Both need data that `/api/data` doesn't serve today.

## Approach

A new `awarenessData(now)` in `devteam.mjs` reads the 12 weeks from `efficiencyWeeks(now)` (kit-173's helper, which kit-98 also uses). Each week is read **as of its end E**, where E = min(the week's last millisecond, now). For a past week E is its end. For this week E is now: a clock read at the week's future end would count a signal formed an hour ago as a day late. Each week runs once inside `withLogAt(E)`: one fold per ended week, none for this week, because `withLogAt`'s fast path covers a cut at or after the last line.

Every clock inside the week reads E. `orientationDebt()` and `incidentDebt()` read `Date.now()` today, and `withLogAt` doesn't move that clock. Both get a `now` argument that defaults to `Date.now()`, and this ticket passes E. The other callers (`cmdOrient` and `collectOoda`'s `ooda.debt`) pass nothing, so they behave as before.

`dashboardDataRead()` reads the clock once (`now`). It computes `efficiency` (`efficiencyData(metrics, now)`, a new optional argument that defaults to `Date.now()`), `autonomy` (`autonomyData(now)`) and `awareness` (`awarenessData(now)`) first, so the three agree on the 12 weeks even across Monday 00:00 UTC (S1-2). It then adds `autonomy_score` from the three objects' weekly scores, so nothing is computed twice.

Alternatives I dropped:
- **Reading `informed` from the stored learning records.** The records hold counts only. The signals part needs each signal's forming and explanation times, and the lessons part needs which knowledge was given. Both need the log at E, so the records can't save the fold.
- **Bucketing the current log by timestamp, with no fold.** "In force at E", "live at E" and incidentDebt's filters all read state, and state changes later (a lesson retired, a decision corrected). The done-when says `withLogAt`.

## The shape

```
awareness: {
  score: { this_week, last_week },        // weeks[11].score, weeks[10].score
  parts: <parts>,                         // weeks[11].parts
  weeks: [ { starts_at, score, parts: <parts> } ×12 ],   // oldest first; the last is this week
  suggestions: [ <suggestion> ≤5 ],       // this week only
}
<parts> = {
  signals:   { count, of, share },        // signals explained within a day
  incidents: { count, of, share },        // fixed incidents that left a lesson
  lessons:   { count, of, share },        // lessons sessions use
  starts:    { count, of, share },        // fresh starts given what they need
}
share = count / of, rounded to 2 places; null when of is 0 (and for starts, also when no knowledge is in force at E)
score = round(100 × mean of the parts' unrounded shares that are not null); null when every share is null

autonomy_score: {
  this_week, last_week,                   // weeks[11].score, weeks[10].score
  weeks: [ { starts_at, score } ×12 ],    // score = round((trust + efficiency + awareness) / 3), null if any is null
}
<suggestion> = { id, kind, what, evidence, effect }
```

`starts_at` is the week's Monday 00:00 UTC (ISO). There is no ISO week name, so the G1 golden's timeless filter strips it, as it does for kit-98 and kit-173.

### The four parts, for the week starting S and read at E

**Signals explained within a day** (`signals`).
- *Groups.* Inside `withLogAt(E)`, signals are grouped as `learningFigures` groups them, before explanations are taken out. Every observation except the kinds `reading`, `retro`, `outcome`, `link` and `learning` is an item on `signalKeyOf(o)`, at `o.created_at`, by `o.created_by`. Every correction of a call is an item on `correction:<class>:<scope|any>`, at the correction's time, by its writer. The grouping is factored out of `learningFigures` into one helper that both use, so the two can't drift.
- *Formed.* A group forms at the item that first makes it recurring. Sort its items by time. The group forms at the first item `j` (from the third item on) where items `0..j` come from two writers or fall on two days. A group that never qualifies didn't form. The week's signals are the groups formed in `[S, E]`.
- *Explained at.* A signal's explanation time `x` is the earliest of these, as of E:
  - for each of its items, each knowledge or problem record whose `evidence` or `refs` cites the item at E: the time of the record's first line that carried that citation (its creation, or the first applied update whose `evidence` or `refs` includes the item);
  - the same for each decision that is live at E (`liveDecision`) and that `explained()` would read (one with an `o-` ref);
  - for each `orient-noise` decision that `explained()` reads as a ruling on the key (live at E, with an `o-` ref, its `refs` naming the key): its `created_at`, when it was made at or after the group's first sighting. A ruling covers the sightings made at or before it (`covered()`), so one from before the first sighting covers none of them and explains nothing, as `learningFigures` reads it (S3-1). A key-only ruling with no `o-` ref explains nothing, as in `explained()` (S1-1). A ruling made after the first sighting but before the signal formed counts as 0 hours, as the done-when says of any explanation from before forming (Calls 3).

  A later line on a record that already cited the item doesn't move `x`. A citation dropped by E, or a decision corrected by E, doesn't count.
- *Counted.* `of` = the week's signals, less those formed after `E − 24 h` with no `x` (they haven't had their day yet). `count` = those with `x ≤ formed + 24 h`. An `x` before forming counts as 0 hours.

**Fixed incidents that left a lesson** (`incidents`).
- `incidentDebt` is split. A new `fixedIncidents(now)` returns, oldest first, the incidents that are resolved (the latest status update says `resolved`), are verified (an `outcome` with valence > 0 cites them), were resolved within 30 days of `now`, and whose status the owner didn't set (`ownerHolds(p, 'status')`).
- `incidentDebt(now)` is `fixedIncidents(now)` less the taught ones (a knowledge record not retired cites it in `evidence`, or a live noise ruling names it), with the same row shape and order as today.
- Inside `withLogAt(E)`: `of` = `fixedIncidents(E).length`, and `count` = `of − incidentDebt(E).length`.

**Lessons sessions use** (`lessons`).
- `of` = knowledge in force at E: accepted knowledge (`learningFigures`' `lists.knowledge`, which the weekly record's `informed.knowledge` counts).
- `count` = those ids carried by the `knowledge` of at least one session start in `(E − 28 days, E]`. A session start is a `worker-slots` act whose `what` starts with `made `, as `learningFigures` counts starts.

**Fresh starts given what they need** (`starts`).
- `of` = the week's session starts in `[S, E]`, as above. `count` = those whose `knowledge` is non-empty. These are `informed.starts` and `informed.starts_given`.
- `share` is null when `of` is 0, and also when no knowledge is in force at E: there was nothing to give.

### Suggestions (this week, E = now)

Up to five, in this order, and cut at five:
1. **Learn from a fixed incident.** One for each row of `incidentDebt(E)`, oldest first.
   - `kind`: `incident`; `id`: `aw-incident-<incident id>`.
   - `what`: "Write down what <incident title> taught".
   - `evidence`: "Fixed <n> days ago and verified since; no lesson cites it" (n counts from the resolution, `incidentDebt`'s `days`). It reads "Fixed today" when n is 0 and "1 day ago" when n is 1 (S2-3).
   - `effect`: "Fixed incidents that left a lesson: <count> of <of> → <count+1> of <of>".
2. **Retire lessons nobody is given.** One, only when the lessons part's `of − count` is at least a quarter of `of` (and `of` > 0).
   - `kind`: `lessons`; `id`: `aw-lessons-unused`.
   - `what`: "Look at the <n> lessons no session was given in 4 weeks" ("the lesson" when n is 1).
   - `evidence`: "<n> of <of> lessons in force reached no session start in the last 28 days" ("lesson" when of is 1).
   - `effect`: "Lessons sessions use: <count> of <of> → <count> of <count> once those are retired" ("once it is retired" when n is 1, S2-3). Rescoping keeps a lesson in force, so the effect names retiring only (S1-3).
3. **Explain something that keeps happening.** One for each row of `orientationDebt(E)`, oldest first.
   - `kind`: `signal`; `id`: `aw-signal-<key>`.
   - `what`: "Find out what keeps causing this: <latest detail, cut to 120 characters>". When the latest detail is empty, it reads "Find out why this keeps happening (<count> times)".
   - `evidence`: "Seen <count> times since <date>, unexplained".
   - `effect`: "First seen <d> days ago; explaining it stops further sightings piling up" (d = floor(hours / 24), at least 1, since every row has waited a day; "1 day"). The count starts at the first sighting, as `orientationDebt`'s `hours` does, so the words say "first seen", not "waited" (S1-4).

Ids are made safe as kit-173's are. The `effId` rule (lower-case, every character outside `[a-z0-9-]` becomes `-`, cut to 110) moves into a shared `suggestionId(prefix, kind, subject)`. `effId` keeps its output exactly, and the test checks one. Two subjects can map to one id (`a:b` and `a/b`, or a cut at 110). The id names the suggestion's thread, so a later suggestion whose id is already taken gets `-2`, `-3` and so on, in list order (S1-7). Every suffixed id is `base.slice(0, 110 − suffix.length) + suffix`, so it stays at most 110 characters. A suffixed id is itself checked against every id taken so far, and the next number is tried if it is taken (S2-4, S3-3). The test builds a clash: signals on the keys `dup:z` and `dup/z` give `aw-signal-dup-z` and `aw-signal-dup-z-2`, in that order (oldest first).

The words are plain, so the owner can act on them from the text alone (strategy R2). No suggestion names a command, a function or the words Informed, Orient or debt. The incident title and the observation detail are what the dashboard already shows elsewhere.

### The Autonomy Score

For each week `i`: trust = `autonomy.decisions.weeks[i].score`, efficiency = `efficiency.weeks[i].score`, awareness = `awareness.weeks[i].score`.
- `score` = round((trust + efficiency + awareness) / 3) when all three are numbers, and null otherwise.
- Trust's score is 0 in a week with no decisions, never null (kit-98). Efficiency's is null under three tickets (kit-173).

## Acceptance checks

All in `test/awareness-data.test.mjs` (new), from hand-written fixture logs with known answers. The lines are dated from this Monday `M`, never from now, as `test/autonomy-data.test.mjs` does. This week's lines sit at `M + span × f`, and the tests that need them skip within 10 minutes of Monday 00:00 UTC.

1. **The four parts, for each of the 12 weeks, read at E** (done-when 1).
   - Every week's four `{count, of, share}` and its `score` equal hand-computed values. `awareness.weeks` has 12 entries, oldest first, the last starting at `M`.
   - The fixture covers each rule:
     - **Signals.** A signal explained 3 h after forming (counts). One explained 30 h after (doesn't count). One explained by an `orient-noise` ruling on its key (counts). One cited by knowledge written before it formed (0 h, counts). One whose first citing record cited it 40 h late while a second record's earlier line cites it in time (the earliest counts). One with a later update to an already-citing record (doesn't move `x`). One cited only by a decision that is corrected before E (not explained). One cited in time by knowledge whose evidence a later `set` before its week's E drops (not explained). One cited in time whose citation is dropped after its week's E (explained, counts: the week reads the log at E) (S2-2). Every noise ruling in the fixture names its key and, for its `o-` ref, an observation on a different key, so the citation rule can't explain the signal in the ruling's place (S3-2). Cases: a ruling made after the first two sightings but before the third (explained at 0 hours, counts); a ruling made 30 h after forming (not within a day), and one made 2 h after (counts); a ruling made before the first sighting (not explained); a key-only ruling, with no `o-` ref (not explained). Each value flips if the ruling rule is dropped, or if it is given spec-2's at-or-after-forming limit, or no lower limit at all. One formed under a day before a past week's E and unexplained (left out of `of`). One formed in the last day before E and explained (in `of`, and counted). A group of three items from one writer on one day (never forms).
     - **Incidents.** An incident resolved and verified in week 5 with no lesson, which reads `0 of 1` in week 5. That week ends more than 30 days back, so `incidentDebt(now)` no longer lists it: a broken `now` argument reads `1 of 1` or null, and the check fails. One with a lesson (counts). One whose status the owner set (left out). One resolved but not verified (left out).
     - **Lessons.** Knowledge given to a start exactly 28 days before a week's E (not used: the window is `(E − 28 d, E]`), one given 28 days less one minute before (used), and one given 29 days before (not used).
     - **Starts.** Starts with and without knowledge. A week with starts but no knowledge in force reads `starts.share` null.
   - The score is the rounded mean of the non-null shares. A week with every part null reads score null, and so do the weeks before the log.
   - *How it fails:* reading any clock at `Date.now()` instead of E, folding at the wrong cut, grouping after explanations are removed, or a wrong formed or explained time each changes at least one hand-computed value above.
2. **Suggestions** (done-when 2).
   - `awareness.suggestions` equals a hand-written list exactly: ids, kinds, order, `what`, `evidence` and `effect`. The incidents come first, oldest first, then `aw-lessons-unused`, then the signals, oldest first.
   - A second fixture has more than five candidates and is cut to five. A third has fewer than a quarter of lessons unused, and gets no lessons suggestion.
   - An id built from a key with `:`, `/` and capitals is lower-case and holds only `[a-z0-9-]`. `effId('tighter-specs', 'spec')` still reads `eff-tighter-specs-spec`.
   - **Other callers unchanged.** In the incidents fixture, `dashboard-data`'s `ooda.debt` (built by `collectOoda`, which calls both functions with no argument) behaves as before. `ooda.debt.incidents` lists the week-5 incident nowhere, since it is over 30 days old now. It lists the fresh unlessoned incident with `days` counted from now. `ooda.debt.signals` lists the old unexplained signal with `hours` counted from now. `orient`'s text names the same incident. The suite's existing tests that read the debts (`test/dashboard.test.mjs`, `test/ooda-lineage.test.mjs`, `test/ooda-knowledge.test.mjs`) pass in CI unchanged.
   - *How it fails:* a wrong order, cut, threshold or id rule changes the list. Defaulting `now` to anything but `Date.now()` moves orient's rows.
3. **The Autonomy Score** (done-when 3).
   - `autonomy_score.weeks[i].score` equals `round((autonomy.decisions.weeks[i].score + efficiency.weeks[i].score + awareness.weeks[i].score) / 3)` in a week where all three are numbers. The fixture merges three or more tickets in one week, so efficiency has a score there. The value is also hand-written in the test, not only recomputed from the payload.
   - It is null in a week where efficiency is null, and in a week where awareness is null. `this_week` and `last_week` equal `weeks[11].score` and `weeks[10].score`.
   - *How it fails:* a wrong weighting, rounding, or null rule changes the hand-written value.
4. **Nothing else moves.**
   - `test/fixtures/g1/dashboard-data.txt` gains exactly the `awareness` and `autonomy_score` blocks G1 yields, re-recorded with `DEVTEAM_G1_RECORD=1`. The plan says what G1 holds: this week's lessons part 0 of 1, starts null, a lessons suggestion, and an Autonomy Score of null (efficiency null).
   - `metrics.txt` and every other golden are unchanged. The G1 test in `test/components.test.mjs` passes in CI.
   - The server's `/api/data` carries the same `awareness` and `autonomy_score` as `dashboard-data`.
   - `autonomy_score.weeks[i].starts_at`, `awareness.weeks[i].starts_at`, `efficiency.weeks[i].starts_at` and `autonomy.decisions.weeks[i].starts_at` are equal for every `i` (one clock read, S1-2).

## Contracts

- **Provides** `/api/data` `awareness` and `autonomy_score` (above). `kit-93` and `kit-90` consume them.
- **Consumes** `efficiencyWeeks`, `withLogAt`, `signalKeyOf`, `correctionOf`, `calls`, `explained`'s reading rules, `liveDecision`, `incidentList`, `ownerHolds`, `orientationDebt`, `incidentDebt`, `efficiencyData().weeks[].score` (kit-173) and `autonomyData().decisions.weeks[].score` (kit-98).
- `orientationDebt(now = Date.now())`, `incidentDebt(now = Date.now())` and `efficiencyData(m, now = Date.now())` gain an optional argument, and with none they return what they return today.
- No log line, schema field, command, flag or setting changes.

## Edge cases

- **A log younger than 12 weeks.** A week that ends before the log's first line is not folded at all. `awarenessData` gives it every part `{ count: 0, of: 0, share: null }` and a null score without calling `withLogAt`, so the Autonomy Score is null there too (S1-6).
- **This week.** E = now, so the fast path applies. A signal formed an hour ago and unexplained is left out of `of`. It is not counted against the fleet.
- **A citation removed, or a decision corrected, after E.** The week keeps it (as of E). Before E, it doesn't count.
- **Knowledge in force with no starts in the week.** Starts reads null (`of` 0). Lessons can still read 0%.
- **A retired lesson citing an incident.** It doesn't teach (`incidentDebt`'s rule), so the incident is still owed.
- **Cost.** Up to 11 extra folds per `/api/data` request (every request is a fresh child process, so nothing caches between requests: kit-98 plan-1 P1). The plan measures one request on a 15k-line log before and after, and records it in verification.md.

## Out of scope

The pages (`kit-93`, `kit-90`), any change to the learning record, `metrics --json` or `orient`'s output, and storing anything.

## Calls I made (for the supervisor to check)

1. **E for this week is now**, not the week's future end. Otherwise "under a day before E" would misjudge today's signals.
2. **An open incident holding a fingerprint isn't an explanation** for the signals part. `explained()` counts it, but the done-when names only citations and noise rulings, and an open incident hasn't explained anything yet. `learningFigures`' own count is unchanged.
3. **The decisions that explain** are those `explained()` reads: live, with an `o-` ref. A noise ruling, like any explanation, counts as 0 hours when it is from before the signal formed. That is the done-when's own rule, and it agrees with `learningFigures`, which counts a group explained when any one item is cited or covered: a ruling counts only once it covers a sighting (made at or after the first), as `covered()` reads it. It can disagree with `orientationDebt`, which lists a group while three or more spreading sightings remain unexplained. A signal can then count as explained in this part and still get an "explain" suggestion. That is the same gap `learningFigures`' count has today. The part measures how fast the fleet first explains a signal, and the suggestion lists what is still recurring, so I kept both as defined. (Spec-1 S1-1 had asked for the ruling to count only from forming; I reverted that half because it narrows the done-when. Spec-2 S2-1.)
4. **Shares are 0 to 1 with 2 places**, as efficiency's parts are. The score is 0 to 100.
5. **The suggestions' wording** is mine, in the mock's spirit. A signal's suggestion quotes its latest observation's detail (cut to 120), since that is what the owner would recognise. It never quotes the key.

## Rulings

None yet.
