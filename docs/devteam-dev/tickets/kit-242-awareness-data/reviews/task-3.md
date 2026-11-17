# Task review: task 3, pass 1

- Reviewer: task-reviewer-3 (fresh subagent, claude-opus)
- Reviewed: e3cf0293ded17e7cd10a66327a03450150ec951d (task 3, diff since 126c1ef)
- Spec compliance: ✅ code matches spec.md › Suggestions word for word (singulars, empty detail, 120 cut, order, ≥ a quarter with of > 0, ids, cut at five) and G1 adds only the one lessons suggestion "What G1 holds" names; one rule is unpinned by any test (T3-1)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T3-1 | Important | spec.md › Suggestions 2 ("and `of` > 0"); task brief named risk (5): a test that passes with a broken rule is a finding | `docs/devteam/scripts/devteam.mjs` `awarenessSuggestions` (`les.of > 0 &&`); `test/awareness-data.test.mjs` | Dropping `les.of > 0 &&` leaves every test green: with of = 0, n = 0 and `4 * 0 >= 0` is true, so a week with no lessons in force would get "Look at the 0 lessons…" / "0 of 0 lessons in force…", yet every fixture that asserts `suggestions` has this week's lessons of ≥ 1 (main 3, young 4, third 5, G1 1), and the `suggestions: []` assertion Task 2 had was removed. Add a check on a log with no lessons in force this week (e.g. a small fixture with only an incident or a signal, or a week-11 log with no knowledge) whose `suggestions` holds no `aw-lessons-unused`, and confirm it fails with the guard removed. | fixed in 6fcbfd5 (a test with no lessons in force; task-3-2 APPROVE) |

Verdict: CHANGES e3cf0293ded17e7cd10a66327a03450150ec951d
