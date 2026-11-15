# Task 4 review, pass 1

- Reviewer: task-reviewer-4 (fresh subagent, claude-opus-5-5)
- Reviewed: 52e4a80d74c01dfb55ecba8f8b181559f884422d

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T4-1 | Minor | quality §3 (tests pin the edges the brief names) | test/dashboard-data.test.mjs:271 | The window is tested only at day 15. Day 13 (the oldest day, in) and day 14 (first day out) are never written, and no item sits exactly on a UTC midnight. So an off-by-one at either edge of the window (`i >= 0`, `i <= 13`, or a `<`/`<=` slip in the index) would pass the test. The code is right today (see Checked). A `chore('edge-in', 13)` / `chore('edge-out', 14)` pair would pin it. | |
| T4-2 | Minor | quality §3 (deterministic tests) | test/dashboard-data.test.mjs:257-283 | The writes and the `data(F)` read happen at different times, and so does the `now` the test uses for its check. If a run crosses UTC midnight, every day shifts by one and the test fails. The run takes about 20 s, so this happens rarely, and the `dayAt` helper shared with earlier tasks has the same exposure. Worth a note, not a fix, unless a `now` override reaches the CLI. | |

Checked:
- Spec §5 shape: `upkeepDays` returns 14 entries `{ starts_at, items, failed }`, oldest first, with `starts_at` the ISO UTC midnight `day0 - (13-i)·DAY` (docs/devteam/scripts/devteam.mjs:11068-11072). `dashboardData` gains `upkeep_days: upkeepDays()` (:12210). Nothing else in `dashboardData` changed.
- Day-index math (:11076): `i = floor((t - (day0 - 13·DAY)) / DAY)`. At t = day0 exactly (today's midnight), i = 13. At day0 - 1 ms, i = 12 (yesterday). At day0 - 13·DAY (day 13's midnight), i = 0, which is in. At 1 ms before that, i = -1, which is out. Tomorrow gives i = 14, which is out. An unparseable `at` gives NaN, which fails `i >= 0 && i <= 13` and is dropped. UTC throughout: `getUTC*` and `Date.UTC`. The off-by-one the report mentions (`13 - floor((day0-t)/DAY)`) is gone.
- Dedupe (:11078): the key is `${i}|${kind}|${ref}`. The day index stands in for the date one-for-one, so this is the spec's date|kind|ref. A ref merged on two different days counts on each day, as §5 says ("same ref on the same day").
- Slug rules order (:11087-11092): `/^chore-(.+)$/` first. Then `isRecordKeeping` (:11064: log, fleet-handoff, drain-handoff, secret-*) or `retro-` is skipped, then `devteam-sync-<tag>` is kit-sync, then `^(ci-fix|devteam-workflow)` is ci-fix with failed, then anything else is chore. This matches the brief, and it matches `CI_RULE_SCOPES` (:4988, `chore:ci-fix`, `chore:devteam-workflow`).
- merge-word (:11093-11095): `tickets().get(refs[0])` (memoised Map, :2648) with `feature === CHORES` (:499, 'chores'). Words are "Merged <title>".
- Review Focus 2: a non-array `refs` is skipped before any read (:11084). `refs: []` gives an undefined ref, and the `typeof` guard (:11087) and `tickets().get(undefined)` handle it. The kit's own records-in-home `merge-word` with `refs: []` (:5470) and a plan merge-word on a non-ticket ref are both skipped. Plans are written as `approve-feature-plan` (:5494) and are ignored. The test writes `refs: []` on day 7 and asserts a quiet day.
- The merge act's real refs (:5494): `[id]`, `[plan]` or `[\`chore-${chore}\`]`. The code reads them as written.
- Retro (:11098): supervisor `retro` observations, the same filter as `lastRetro` (:11129). The ref is the observation id and the words are "Retro". The test checks the `retro-*` chore on the same day is not counted again (test :265-266, :278).
- Supervisor-only: `created_by` is the line's `by` (`logObjects` build, :1419).
- Words hold no class id: every class id is hyphenated (CLASS_WORDS :1135), and "Retro", "Kit synced to", "CI fix" and "Merged chore" contain none. The slugs are verbatim, as §5 asks.
- Test against the brief: all 8 assertions are present (test :273-283). The duplicate tidy (two ids) tests the dedupe. chore-log tests isRecordKeeping. Every non-day-3 `failed` is false. Each day is checked in `at` order. Log bytes are compared before and after.
- The plan-review disposition holds: one `b0 = dayAt(0)` and one `t0`, with ages `t0-b0`, `-10`, `-20`, `-30` in write order (test :257-262). `handLine`'s `used` tie-break keeps the order monotonic.
- Read-only: the function reads `logObjects` and `tickets()` only. Files touched: devteam.mjs and the test file only (diff stat).
- Recurring checks were not added (kit-168 ruling).
- Not re-run. The implementer's GREEN run is in the report. No doubt needed a focused run. The G1 golden difference is expected (Task 7).

Verdict: APPROVE 52e4a80d74c01dfb55ecba8f8b181559f884422d
