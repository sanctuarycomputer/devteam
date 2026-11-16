# Final review, pass 1

- Reviewer: k98-final (fresh subagent, claude-opus-5-5)
- Reviewed: c5f25051a162e26ceceb2623513951261a75de40 (the whole branch)

I read spec.md, plan.md (Global Constraints, Review Focus 1-5, Rulings), verification.md, pr-body.md and every task review. Then I read the whole branch diff (`git diff origin/main...HEAD`): devteam.mjs, test/autonomy-data.test.mjs and the G1 golden. I also read the code it depends on: withLogAt, learningFigures, lessonEfficacy, writeLearning, appendLog, readLog, memo and the log-derived globals, questionView/questions, rungHistory, rungFor, actAuthority, decisionRecords, sensorStatus, sensorCredentialState, the `sensor discover` branch, and the goal hold/status/met writers.

What I checked by reading:
- **The figures.**
  - alone: own authority, created in the week, no correction at or before the week's end.
  - asked: answered plus defaulted questions by `answered_at`, owner goal updates with a decision, status or hold read from `byType.get('goal')` (so Upkeep is included), and owner preference or `class:` rules at `created_at`, retired ones too.
  - corrected, merged and with_recommendation come from the stored record, else the computed one, else `{}`, with `num()` guarding every figure.
  - asked_again checks all five conditions. hours_waiting is a sweep union over the intervals sorted by start and clipped to `[start, end)`.
  - Rounding is to 0, 2 and 1 places. Every field is a number.
  - Only the owner can answer a question (questionView), so `answers` and `asked` can't count anyone else.
- **withLogAt's fast path.** When every line is at or before the cut, the slow path would rebuild the same fold, so the fast path gives the same result. The globals that the slow path resets without checking the log's identity are roadmapMemo, spendMemo, STATUS_MEMO and SENSOR_KEYS. Could one of them be stale? Only after an append in the same process, and any append is dated now, so the fast path can't fire then. writeLearning computes every week before it appends. lessonEfficacy(r.cut) always has the record's own line after the cut. I found no stale memo.
- **Cost.**
  - This week takes the fast path.
  - A week before the first line computes nothing (`end > first`).
  - An ended week with no record costs one fold, and writeLearning back-fills 104 weeks, so once it has run that is 0 folds.
  - With no cache, every poll repeats these folds. plan-1 P1 accepted that.
- **Trust.** The walk caps every step as rungFor does, and both caps are idempotent and depend only on the latest raw rung. So the last effective rung equals rungFor(cls).
- **Senses.** has comes from sensorStatus rows, and all those rows go into needed, so needed ≥ has. An http sensor can't carry credentials, so its missing `credentials` field is right. The cache is written after `--record`'s role check, in every mode. A malformed cache reads as null.
- **Project-specific content.** None: the code is generic. `sentry` and similar names appear only in test fixtures.
- **The golden.** It only adds `autonomy`. `starts_at`, `hours_waiting` and `discovered_at` are filtered out as time-dependent.

What I ran: a scratch worktree at c5f2505 under a private mktemp dir, with every DEVTEAM_* variable unset, a fresh HOME and DEVTEAM_HUB_PORT=4384, one file at a time at --test-concurrency=2.
- `test/autonomy-data.test.mjs` passed 10 of 10, with none skipped.
- G1 (`--test-name-pattern '^G1' test/components.test.mjs`) passed.

What I mutated (decision tests run with `--test-name-pattern 'decisions|record'` unless named):
- withLogAt fast path `every` → `some`, which wrongly skips the refold for past cuts. test/ooda-learning.test.mjs fails 2 of 5, so the existing callers are protected. The autonomy tests don't notice, because learningFigures filters everything by date.
- isOwnerRule without `writerClass(k.created_by) === 'owner'`: **survives** (F1).
- The goal-update filter without `writerClass(u.by) === 'owner'`: **survives** (F1).
- score `Math.round` → `Math.floor`: **survives** (F2).

The scratch worktree and dir were removed afterwards.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | spec.md:69-72 ("asked = the owner's own decisions": "the owner's goal updates…", "knowledge written by the owner"); quality.md §3 (a missing test with a plausible failure path) | docs/devteam/scripts/devteam.mjs:10523 and :10532; test/autonomy-data.test.mjs decisionsFixture | No test pins asked's owner-only filters. Dropping `writerClass(u.by) === 'owner'` from the goal-update loop passes every decision test. So does dropping it from `isOwnerRule`. The fixture has no fleet-written goal update with a hold, status or decision, and no fleet-written preference or `class:` lesson. Such lines are routine. The supervisor sets goal holds (`goal hold`, :4014, the `by !== 'supervisor'` branches at :11273). It writes status and decision updates (`goal status`, goalMetApply at :10825). It writes class-scoped lessons with `knowledge add`. A regression here would count the fleet's own lines as owner decisions, which inflates asked and silently deflates the headline score. Fix: in decisionsFixture, add a supervisor hold or status update on X.goal and a supervisor-written `class:` lesson in week 8, with asked staying 6. Each mutation should then fail. | fixed in 54d3f850: week 8 gains a supervisor drain on a running goal and a supervisor class: lesson, asked stays 6; dropping either owner check fails the test |
| F2 | Minor | plan.md Global Constraints ("score = round(100 × alone / decisions)"); quality.md §3 (mutate where a test can't prove it) | test/autonomy-data.test.mjs:150-157 | No fixture score has a fraction of .5 or more: 2/9 gives 22.2, plus 1/2 and 1/1. So `Math.floor` in place of `Math.round` passes. The headline number's rounding is unpinned. One week whose fraction is ≥ .5 would pin it, e.g. 2 alone of 3 (66.7 → 67). | fixed in 54d3f850: week 6 is 2 alone of 3 decisions, score 67; Math.floor fails the test |

Verdict: CHANGES c5f25051a162e26ceceb2623513951261a75de40
