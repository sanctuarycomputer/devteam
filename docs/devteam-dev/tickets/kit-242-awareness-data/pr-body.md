`/api/data` gains `awareness` and `autonomy_score`, the data behind the Awareness page and the Overview's Autonomy row (design: Autonomy pages › Awareness; Overview › Autonomy). kit-93 and kit-90 draw them. Both are computed on read and add nothing to the log.

- **awareness, per week:** each of kit-98's 12 calendar weeks is read as of its end E, where E = min(week end, now). Past weeks fold the log at E with `withLogAt`; weeks that end before the log's first line are skipped. Each week has four parts, each `{ count, of, share }`, with a null share when `of` is 0:
  - **signals explained within a day:** signals that became recurring that week, grouped as `learningFigures` groups them, less those formed in the last day before E and still unexplained. A signal counts when its first explanation came within 24 h of forming, or before it. An explanation is a knowledge or problem record, or a live decision with an `o-` ref, citing one of its items (dated by the first applied line that carried the citation, if still cited at E), or a live noise ruling on its key made at or after its first sighting.
  - **fixed incidents that left a lesson:** of those resolved and verified in the 30 days to E (owner-set ones left out), the share not in `incidentDebt(E)`.
  - **lessons sessions use:** of the knowledge in force at E, the share given to a session start in the 28 days to E.
  - **fresh starts given what they need:** starts given knowledge, over the week's starts; null with no knowledge in force.

  score = round(100 × the mean of the non-null shares), and null with none.
- **awareness.suggestions:** up to five for this week, in plain words. Incidents in `incidentDebt(now)` come first, oldest first. Then one lessons suggestion, when a quarter or more of the lessons in force reached no start in 28 days. Then the signals in `orientationDebt(now)`, oldest first. Ids are `aw-<kind>-<subject>`, made safe by the rule `effId` uses (now the shared `suggestionId`) and de-duplicated with `-2`, `-3`.
- **autonomy_score:** for each week, round((Trust + Efficiency + Awareness) / 3), null in a week where any of the three is null. `this_week` and `last_week` are included.
- **No behaviour change for other callers:** `orientationDebt(now)`, `incidentDebt(now)` (split into `fixedIncidents` and the lesson filter) and `efficiencyData(m, now)` gain an optional `now` that defaults to `Date.now()`. `learningFigures`' grouping moved into `recurringGroups()` with byte-identical output. `dashboardDataRead` reads the clock once, so the four blocks agree on the weeks.
- **Cost:** up to 11 extra folds per request. Measured in a clone of the home log (about 15k lines): main 6.24 s and 6.50 s, this branch 6.56 s and 6.75 s.

## How to verify

- `node --test --test-concurrency=2 test/awareness-data.test.mjs` runs one hand-written fixture with every case and hand-computed answers. It covers all 12 weeks' parts and scores (including a week ending more than 30 days back whose incident part reads 0 of 1 only because the clock is E), the suggestions and their words, clashing ids, the quarter threshold, `ooda.debt` unchanged, the Autonomy Score (83 in week 7, the nulls, and the rounding), the four blocks' weeks aligned, and the server's `/api/data` matching `dashboard-data`.
- `node --test --test-concurrency=2 test/components.test.mjs`: the G1 golden gains only `awareness` and `autonomy_score`, and `metrics.txt` doesn't move.
- CI (test.yml) runs the full suite. See `docs/devteam-dev/tickets/kit-242-awareness-data/verification.md`.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
