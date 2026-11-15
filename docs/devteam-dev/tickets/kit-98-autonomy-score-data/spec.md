# kit-98-autonomy-score-data: spec

The Autonomy Score's data: decisions, trust and senses this week, and each measure over the last 12 weeks. Feature `dashboard-cleanup`, story DCL-S7. Design: `project/designs/a-cleaner-more-consistent-dashboard.md`, Autonomy pages › Trust › The Autonomy Score (rulings `m-20261114-211957705-supervisor`, `m-20261114-212120161-supervisor`, `m-20261114-234218588-supervisor`; owner thread `t-20261114-211941939-owner`). This ticket computes `/api/data` `autonomy` on read; `kit-93` draws it. Nothing new is stored in the log.

## Why

The Trust page opens with one number: the share of this week's decisions the fleet made without asking, that the owner didn't correct, with last week's beside it. Under it go the owner-load counts (W1 changes merged per question answered, W2 questions asked again, calls corrected, hours waiting on the owner, answers that went with the recommendation), each over 12 weeks. After those come trust (the kinds of decision it takes alone) and senses (what it can see). Today the weekly learning record holds most of these counts, but only as a feed on the Loop page, and nothing turns them into a score.

## Approach

`autonomyData()` in `devteam.mjs` is called by `dashboardData()` and puts its result in `autonomy`. Each week's counts come from **the weekly learning record**:
- for an ended week with a stored record (`learningRecords()`), the record's `figures`;
- for this week, or an ended week since the log began that has no record yet, `learningFigures(week).figures`, computed on read: the same code `observe-metrics` writes the records with;
- for a week before the log's first line, zeros, with nothing computed.

Some figures aren't in the learning record, which holds only counts. These are counted per week from the log on read (ruling `m-20261115-224929460-supervisor`): the three-way split's decided alone and asked the owner, questions asked again, and hours waiting on the owner. The split can't come from the record: the record's `calls` count includes acts that an owner's answer or a default approved, which were asked, not decided alone (spec-1 S1). The record supplies merged, corrections and answers with the recommendation. A figure missing from a stored record (an older or hand-edited line) reads 0.

Cost: `learningFigures` folds the log again for each week it computes (`withLogAt`). `withLogAt` gets a fast path: when no line is newer than the cut (this week's cut is in the future), it runs `fn` on the log as it is, with no refold. Usually only this week is computed, so a request costs no extra fold. An ended week with no stored record costs one fold, and there are at most 11 such weeks. Its figures are kept in a module-level cache keyed by the week and the log's line count and last line's `at`, so the dashboard's 10-second poll refolds only when the log has grown.

I dropped two alternatives:
- Bucketing every count from the current log by timestamp. That is a second code for figures the record already holds, and the done-when says "from the same weekly learning record".
- Writing the extra figures into future learning records. That changes a log line's shape and back-fills nothing.

**The 12 weeks** are the last 12 calendar weeks (`mondayOf`, Monday 00:00 UTC), oldest first, ending with this week. They are kit-173's weeks. kit-98 builds after kit-173, so this ticket reuses kit-173's week helper if it landed one, and otherwise adds one that kit-173's code can share. Weeks carry `starts_at` and no ISO week name, so the G1 golden's timeless filter holds (the same rule as kit-173).

## The shape: `autonomy`

```
autonomy: {
  decisions: {
    score: { this_week, last_week },     // weeks[11].score, weeks[10].score
    this_week: <week>, last_week: <week>,// weeks[11], weeks[10]
    weeks: [ <week> ×12 ],               // oldest first, the last is this week
  },
  trust: {
    own, kinds,                          // ladder classes at rung 3, of all ladder classes
    raised, dropped,                     // effective rung moves this week (counts)
    changes: [ { class, from, to, at, id } ],  // those moves, oldest first
  },
  senses: {
    needed, has, working,                // counts
    missing: [ name ],                   // needed and not had, sorted
    names: { needed: [], has: [], working: [] },
    discovered_at,                       // when the cached discovery ran; null if never
  },
}
<week> = {
  starts_at,                             // ISO, Monday 00:00 UTC
  record,                                // id of the stored learning record, or null (computed / before the log)
  alone, asked, corrected, decisions,    // the three-way split and its total
  score,                                 // round(100 × alone / decisions); 0 with no decisions
  lessons,                               // this week only: accepted lessons in force (the record's lists.knowledge), for the "lessons it counted" link (W4); [] on other weeks
  merged, answers, merged_per_answer,    // W1: merged ÷ max(1, answers), 2 places
  asked_again,                           // W2
  hours_waiting,                         // 1 place
  with_recommendation: { count, of, share },  // share 2 places; 0 when of is 0
}
```

### Each figure, per week

From the learning record (`R` is the week's `figures`; a missing figure reads 0):
- **corrected** = `R.trusted.corrections`: corrections dated in the week, of the fleet's calls (`calls()`). A correction can be of a call made in an earlier week; the record counts it in the week it was made, and so does the score. That is the record's rule, kept so the two agree.
- **merged** = `R.autonomous.merged`: tickets merged in the week.
- **with_recommendation** = `{ count: R.trusted.agreed, of: R.trusted.answered }`: answered questions that carried a recommendation, and how many went with it.

Counted on read, per week, from the log:
- **alone** = the fleet's calls (`calls()`: decisions, and acts that are their own call, less owner acts and the tidy of a finished worktree) created in the week whose authority is the fleet's own (`rung`, `standing-rule` or `constitution`: a decision's `authority`, an act's `actAuthority`), and that had no correction dated on or before the week's end. A call approved by an owner's answer (`answer`) or by a question's default (`default`) is not alone: its question is counted in asked.
- **asked** = the owner's own decisions dated in the week:
  - questions answered by the owner (status `answered`, `answered_at`) or settled by their default (status `defaulted`, `answered_at`: put to the owner, who let it default);
  - the owner's goal updates with a verdict, status or hold (`at`), as `decisionRecords()`'s goal rows read them;
  - the owner's standing rules: knowledge written by the owner of kind `preference` or with a `class:` scope (`created_at`). A rule retired later still counts in the week it was made, so past weeks don't move. An owner's fact is not a decision (spec-1 S5).
  Corrections aren't counted here, because they are `corrected`. The box operator writes no line to a project log (its words are information, never a decision), so it is never counted. The test shows that an operator-thread turn and a `machine tell` count nowhere.
- **decisions** = alone + asked + corrected.
- **answers** = questions the owner answered in the week (status `answered`; defaulted and withdrawn ones don't count).
- **asked_again** (W2, matching fleet-owner-load's declared re-asks) = questions asked in the week with `new_because`, the supervisor asking again on purpose about something the owner decided. A re-ask after `links_moved` doesn't count. `ask` keeps `new_because` only when an answered question matches, so a plain re-ask of a withdrawn question with moved links carries none. The rule also holds for a line that carries it anyway (a hand-written line, or an older kit). Question Q (with `new_because`) is not counted when some question P satisfies all of these:
  - P has status `withdrawn`;
  - P was settled (`answered_at`) at or before Q's `asked_at`;
  - P has the same class as Q (both null counts as the same);
  - `nearlySameQuestion(P.question, Q.question)` holds;
  - `artifactLinksMoved(P)` is non-null.

  The links are checked against the artifacts as they are now (what the kit can read), so a past week can change if an artifact later changes again. The test writes such a Q by hand, so it exercises the exclusion itself and not just `ask`'s guard (spec-1 S7).
- **hours_waiting** = the hours of the week in which at least one question was open: the union of the intervals `[asked_at, answered_at or now)` (`answered_at` is set for every settled status), clipped to the week, so two questions open at once count once.

**Last week and this week** are entries 10 and 11. Every field is a number, never null or missing. A week with nothing in it reads 0 in every field. A week with no decisions (alone + asked + corrected = 0) has score 0, and its other counts are whatever happened (merged, hours waiting) (spec-1 S4).

### Trust (this week)

- **own / kinds:** the number of `ladder().classes` whose `rungFor(cls)` is 3, out of the number of classes.
- **raised / dropped / changes:** walk each class's `rungHistory(cls)`. The effective rung at any point is the walked rung capped as `rungFor` caps it: `min(r, ceiling)`, and for `incident-fix`, with `releasesOnMerge()`, also `min(r, max(2, rungFor('release-production')))` (the cap as it is now). The walk starts from the capped `def.start`, so the last effective rung equals `rungFor(cls)` (spec-1 S8). An event dated this week whose effective rung is above the one before counts as raised; one below counts as dropped. An event that leaves the rung the same isn't a change.

### Senses

`sensor discover` costs too much to run per request: it runs CLIs with 30-second timeouts. So every `sensor discover` run (with or without `--record`, `--json` or text) writes what it found to `runPath('sensor-discovery.json')`, as `{ at, sensors, proposals: [name], missing: [name], outside: [name] }`. `outside` is the names in `outside.proposals[]` when discover's result has one (outside-senses), and `[]` until it does. A missing or unreadable file reads as no discovery.
- **needed** = the union of the sensors in place (`sensorList()`) and the cached discovery's proposals, missing and outside names, deduplicated by name and sorted. The sensors in place belong in "needed": what it has is a subset of what it needs, as in the mock (needed 4, has 2).
- **has** = sensors in place that need no credential (none declared), whose `sensorCredentialState(name).status` is `posted`, or that are working (a sensor that reads what it should has its access, however it was given) (spec-1 S10).
- **working** = sensors in place whose state is `ok` (a probe or stream) or `up` (http).
- **missing** = needed, less has.

Every sensor in has is in place, and every sensor in place is in needed, so needed ≥ has always holds; the test checks it (ruling `m-20261115-224929460-supervisor`).

## Acceptance checks (the done-whens)

1. `test/autonomy-data.test.mjs` passes in CI. `/api/data` (`dashboard-data`) carries `autonomy`, built from hand-written fixture logs with known answers:
   - **decisions:** this week's and last week's score; merged per answer; asked again, with a re-ask after `links_moved` not counted; corrected; hours waiting, with overlapping questions counted once; with the recommendation as a count and a share.
   - Each of those, and alone / asked / corrected, for every one of the 12 weeks. An act approved by an owner's answer, and one approved by a default, are not alone; the defaulted question is asked. The fixture has one ended week with a stored learning record whose figures differ from what a recompute would give, so the test proves the stored record is read. It also has one ended week with no record (computed) and this week (computed).
   - Decisions include the owner's answers, goal decisions, holds and standing rules, and corrections; an operator's words count nowhere.
   - **trust:** own of kinds; one class raised by a trust answer this week and one dropped by a correction this week, with an earlier week's move not counted.
   - **senses:** a fixture with a sentry dependency, so `sensor discover` writes the cache with a missing `sentry`; a hand-written cache with `outside` names, which are counted; sensors in place with and without credentials, ok and failing; needed, has and working counted, missing named, and needed ≥ has.
2. The same test: each series holds 12 entries, oldest first, the last starting this Monday 00:00 UTC. The fixture's lines are dated from this Monday, never from now, so a run near Monday 00:00 UTC can't split them across two weeks (spec-1 S13). The G1 golden's own lines are written at run time and take seconds, so it carries that risk only in a run that crosses the boundary. asked again and hours waiting are counted per week from the log. A week with no decisions reads 0, not null or missing.
3. Nothing else changes: `metrics.txt` doesn't move. `test/fixtures/g1/dashboard-data.txt` gains only the `autonomy` block G1 yields. It joined touches by ruling `m-20261115-224310516-supervisor`.

## Contracts

Provides `/api/data` `autonomy` (above), which `kit-93` consumes; `kit-99` adds `autonomy.suggestions` beside it. Consumes `learningRecords`, `learningFigures`, `decisionRecords`, `questions`, `ladder`, `rungFor`, `rungHistory`, `sensorList`, `sensorStatus`, `sensorCredentialState` and kit-173's 12 weeks. A new run file, `run/sensor-discovery.json`, is a cache only: any reader treats it as absent when it is missing or malformed. There are no log, schema or command-line changes.

## Edge cases

- **A log under a week old:** 11 weeks of zeros, and only this week is computed.
- **A stored record and a recompute disagree** (the record was made by an older kit): the stored record wins. It is the record the owner was shown.
- **A correction of an earlier week's call:** it is counted in the week it was made (corrected), and the call stays alone in its own week only if the correction came after that week ended.
- **A question still open:** it counts until now. One asked before the 12 weeks and still open counts from the start of each week.
- **kit-23 (owner-load figures):** not landed. If it lands first, W1 to W3 reuse its figures (the ticket's notes), and this spec's definitions follow fleet-owner-load's W2 declared re-asks so they agree.

## Out of scope

The page (`kit-93`), suggestions (`kit-99`), possible (undeclared) re-asks, and changing the learning record or `metrics --json`.

## Calls I made (for the supervisor to check)

1. **asked** and **alone** are counted from the log (ruling `m-20261115-224929460-supervisor`), because the record can't tell acts approved by an answer from the fleet's own calls. **asked** is the owner's decisions dated in the week. It is not `R.autonomous.questions` (questions asked), because the done-when lists the owner's answers, goal decisions, holds and rules.
2. **has** also counts a working sensor.
3. **hours_waiting** is the union of the intervals in which any question was open. It is not fleet-owner-load's blocked/waiting state, which would need the fleet's state replayed over time.
4. **needed** includes the sensors in place (ruling `m-20261115-224929460-supervisor`), and discovery is read from a cache that `sensor discover` writes.
5. The score and counts read 0 with no decisions (the done-when). merged per answer divides by max(1, answers).

## Rulings

- `m-20261115-224310516-supervisor` (re `m-20261115-224254116`): `test/fixtures/g1/dashboard-data.txt` is in touches; rebase onto kit-173's version once it merges.
- `m-20261115-224929460-supervisor` (re `m-20261115-224922958`, spec-1 S2 and S3), both approved: (1) senses needed = sensors in place + discover's proposals + missing + outside, so needed ≥ has always holds, and the test checks it; (2) the weekly split is counted per week from the log (owner answers, defaults, goal decisions, holds, rules; calls on their own authority), while merged, corrections and with-recommendation stay from the stored record.
