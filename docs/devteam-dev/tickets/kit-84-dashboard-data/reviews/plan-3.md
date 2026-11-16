# Plan review, pass 3

- Reviewer: plan-reviewer-3 (fresh subagent, claude-opus-5-5)
- Reviewed: 0243dcba1d29899985b115af8532402b8fb25b02 (plan.md; pass-2 fixes)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P3-1 | Important | quality.md §3 (a test that can't do what it claims); the P2-1 fix | plan.md:54-57, 224, 235 | `handLine`'s tie-break breaks T4, in two ways. (a) It checks `used` against the raw `at`, but the id's `stamp` and the line's ISO `at` both truncate to the millisecond. For `d = 0`, `dayAt(0) = day0 + (Date.now() - day0) / 2` is a half-millisecond about half the time, so two day-0 lines can get `at` 500 and 500.5. Neither is in `used`, both truncate to the same ms, and the two `chore-tidy` lines share an id. That defeats "two lines, two ids: the code's dedupe is what is tested", and a duplicate id may also fail the log's integrity check. (b) On a real tie it subtracts 1 ms, so a line written later gets an earlier `at`. `dayAt(0)` advances only 0.5 ms per ms of clock, so the four day-0 lines (tidy, tidy, docs, log), written back to back, often tie. They then come out in reverse write order: log, docs, tidy, tidy. Day 0's items are then `[docs, tidy]`, and the assertion `[['chore','chore-tidy',…], ['chore','chore-docs',…]]` "in `at` order" fails, or flakes with timing, however the code is written. Fix: floor `at` to a whole millisecond before the `used` check. Then keep write order: on a tie add 1 ms (the result stays in the past for every caller's `agoMs`), or have T4 give its day-0 lines explicit spaced offsets in write order. | fixed: at is floored to a whole millisecond before the tie check, and a tie adds 1 ms, so ids are unique and write order holds; dayAt(0) is whole milliseconds |
| P3-2 | Minor | feasibility (clarity for the implementer) | plan.md:55 | "`stamp` is `F.hand`'s", but `stamp` is a local inside `threadsFixture` (test/lib/kit.mjs:150) and isn't in the object it returns (kit.mjs:192). Nothing else exports it. Say the test defines its own `stamp`, copied from kit.mjs:150, so no one goes looking for an export or edits kit.mjs (not in this ticket's file list). | fixed: the plan says the test copies threadsFixture's one-line stamp, which kit.mjs doesn't export |

Pass 2's findings:
- **P2-2, P2-3, P2-4 and P2-5 are fixed.**
  - `cmdWithdraw` (devteam.mjs:5980) checks only that the caller is the supervisor and that the question is open. It never looks at the question's kind, so `F.sup(['withdraw', qg, '--reason', 'test'])` withdraws the open goal-approval question.
  - `ticketMode` (devteam.mjs:3639) reads only the goal's hold. So t-e is `run` before `goal hold <g2> park --owner` and `park` after, and the before/after pair tests `live()`.
  - The defaults check now uses `mainKeys`, taken from main's settings block, and no longer relies on the `set` the code computes.
  - G1 Step 2 checks `--stat` first.
- **P2-1 is fixed for T2, but not for T4.**
  - `handLine` now takes an age the way `F.hand` does. `F.logDir` and `line` are both reachable: kit.mjs:21 and :192.
  - The line format, default file name and `at` match `F.hand`'s exactly.
  - T2's phase lines land 5 min and 2 h back, which is inside `since`, so `collectMetrics` (devteam.mjs:11257) reads them.
  - T4's `Date.now() - dayAt(d)` puts days ≥ 1 on their own midnight plus 30 min. Day 0 is where the tie-break fails (P3-1).

Verdict: CHANGES 0243dcba1d29899985b115af8532402b8fb25b02
