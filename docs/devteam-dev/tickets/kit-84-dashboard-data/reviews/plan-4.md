# Plan review, pass 4

- Reviewer: plan-reviewer-4 (fresh subagent, claude-opus-5-5)
- Reviewed: 4fd00b596ea1292b3dcd4200d607d93af2959813 (plan.md; pass-3 fixes)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P4-1 | Minor | quality.md §3 (a claim the plan can't back) | plan.md:54, 58-60, 224 | Two of the new sentences are stronger than the mechanism. (a) "A line written later never sorts earlier": the tie-break only resolves exact equal values. T4 passes `Date.now() - dayAt(0)`, so a day-0 line lands at `dayAt(0) + (nC - nA)`, where `nA` is the caller's `Date.now()` and `nC` is the one inside `handLine`. Clock lag inside a call counts in full, but the clock between calls counts only half (because of the `/ 2`). If the runtime stalls about 2 ms or more in that microsecond window (a GC pause, say), a later line can get a smaller unused `at` and sort before an earlier one. One example: tidy-1 at 60, tidy-2 at 55, docs at 56. If the code keeps the first tidy it reads, day 0 comes out `[docs, tidy]`. (b) "Callers keep lines at least a minute from now" isn't true of `dayAt(0)`. In the first few ms after UTC midnight, the four day-0 lines plus their +1 ms tie-breaks can land a millisecond past `now`. They are still inside today, so nothing asserted breaks. Both windows are tiny, so this isn't a realistic flake, but the wording overstates. Optional fix: have T4 compute `dayAt(0)` once and pass explicit spaced ages in write order (for example `base - i`). Or reword the two sentences. | |

P3-1 and P3-2 are fixed.
- **P3-1(a), unique ids.** `at` is now a whole millisecond before the `used` check, and `dayAt(0)` is floored too. Every `at` in `used` is a distinct integer, so the ms-truncating `stamp` and ISO `at` are distinct for every line. The two `chore-tidy` lines get two ids.
- **P3-1(b), write order.** A tie now adds 1 ms. Four day-0 lines written back to back in the same millisecond come out at x, x+1, x+2, x+3, in write order. If the clock ticks between calls, `dayAt(0)` only moves forward and the tie-break walks forward past used values, so the order holds. I traced the case where a millisecond boundary falls inside one call: tidy-1 at F+1, tidy-2 at F, docs at F+2. A docs line can't fall below the earlier tidy without a multi-ms stall (P4-1), so the assertion `[tidy, docs]` holds in practice.
- **Today's day.** Every line stays inside today's UTC day. `dayAt(0) ≥ day0`, and the few +1 ms can't reach the next midnight. Even at `Date.now() - day0` of 0-3 ms the lines are day0..day0+4.
- **P3-2.** `stamp` is described as a copy of `threadsFixture`'s local (kit.mjs:150). That is right: kit.mjs doesn't export it.
- **T2.** Its lines (5 min, 2 h and 60 s back) are unchanged in substance. `Math.floor` of an integer `Date.now()` minus an integer age is the same value. A tie only moves a line 1 ms later, so the lines still land well inside `since` and on the intended sides of the blocked threshold.
- **The rest of the diff.** No other defect.

Verdict: APPROVE 4fd00b596ea1292b3dcd4200d607d93af2959813
