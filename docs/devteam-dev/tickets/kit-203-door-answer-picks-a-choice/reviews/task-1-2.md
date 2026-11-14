# Task 1 review, pass 2

- Reviewer: task-confirmer (fresh subagent, claude-opus-5-5)
- Reviewed: 782468b625f2b889ef59be5f3f3b6dfb92fa7bb6 (cold confirm of pass 1's fixes, diff-only)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| C1 | Minor | L-TEST-1; spec "The other copy never shows it" | test/dashboard.test.mjs:664-670 | F1 is fixed: Answer on a copy with no ask calls `dropAsk(id)` (every copy) before drawing it there, then sets `ASKS`. Subtest 7 checks thread-then-Inbox only; the reverse that F1 also asked for (Inbox first, then the thread copy, then an Inbox redraw drawing none) is not tested. The code path is the same one, and an Inbox redraw with `ASKS[id] === 't'` drawing none is already checked earlier in subtest 7, so this is a gap in coverage, not a bug. | |

Checked and found right:
- F1: pressing Answer twice on the same copy keeps one ask: the second press finds `[data-which-for]` on the card, so it neither drops nor inserts, and `ASKS[id]` is set to the same copy again. An ask moved to the thread copy sets `ASKS[id] = 't'`, so `questionCard` (line 1333, `ASKS[q.id] === (copy ? 't' : 'q')`) draws none on an Inbox redraw. Moving it the other way removes the thread copy's ask from the DOM; the test asserts that and asserts one ask in `#questions` after two polls.
- F2: subtest 4 now ticks the rule box and checks `standing_rule` and that the posted `seen` equals the logged hash. A refused post from the ask goes through `answerPress` as Answer does (pass 1 checked that by reading the code), so leaving it untested is acceptable for a Minor.
- F3: `dropAsk` uses `(card || document)`; `qText` reuses `qv`. Behaviour is the same.
- The fix adds no new problem. With `card` null, `card?.` short-circuits as before.
- `node --test --test-name-pattern 'asks which choice' test/dashboard.test.mjs`: 8 pass, 0 fail (all 7 subtests).

Verdict: APPROVE 782468b625f2b889ef59be5f3f3b6dfb92fa7bb6
