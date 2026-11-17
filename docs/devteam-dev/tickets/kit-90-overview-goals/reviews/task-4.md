# Task 4 review, pass 1

- Reviewer: task reviewer (fresh subagent, claude-opus)
- Reviewed: 6482a31 (Task 4 and the T3-1 fix, dc9c8e7..6482a31)
- delta-3 F1: confirmed in task-3.md

Spec compliance: ✅ The goal peek's nine keys run in the done-when's order. GOAL_PEEK and GOAL_PEEK_SECTIONS sit in the `goal-peek` marker block. Upkeep's peek matches §5. The Next chip appears on exactly the card for NEXT_ID() and the first Needs you row. With fed3d20, a failed hello makes the pill read `unknown` (§1).
Quality: Clean, and every changed hunk lies after both shell blocks (CSS 46–206, JS 1191–1463). The three findings are Minor and need no code fix.

Checked:
- P15. The test's deepEqual is exact, `{ id: g1.impact.decision, reason, impact: 2 }`, and it also checks `dec !== g1`.
- Focus 5. Confirm let go survives the polls, and it survives a redraw from scratch (`LAST_HTML=''`, drawer emptied, `openGoal`). That redraw proves the state lives in page memory.
- The chip. `copy` excludes a thread's copy of a card, so it never gets one. Secrets cards go through `questionCard`, and review cards get the chip from `reviewCard`.
- The goal's Upkeep card opens Upkeep's peek.
- HELLO's readers all use `?.` and fall back to `unknown`, `DATA.project` and an empty mosaic.
- The two outside assertions that moved test the same thing as before: the same measure value under its new label, and the same "record landed" wait on the renamed row.

Mutation checks (private copy of HEAD, node 22, own HOME):
- `holdControl`'s `sure = false`: the goal peek test fails at "still Confirm let go after a redraw from scratch".
- `nextChip` on every card: the Next chip test fails with 4 chips where it expects 2.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T4-1 | Minor | spec §5 line 62 | index.html `GOAL_PEEK.goal` | Spec line 62 lists Design, Forecast, Features, Planners, Your verdicts and Questions among the `goal` section ids. The build keeps them as kit-88's Computed rows, and `GOAL_PEEK.goal` = steps, readings, tldr, problems, decisions, progress. Line 59 supports this ("kit-88's frame and inventory kept … then its Computed rows"), as do kit-88's inventory test (it asserts them as `dt:` rows) and the owner's mock (`fillGoal` draws them under `computed(...)`; line 5 says the mock wins). So the behaviour is right, but the spec's own text contradicts it. Have the supervisor record a ruling, or amend line 62's parenthetical, so a later reader (recurring-upkeep) doesn't treat it as a gap. | |
| T4-2 | Minor | spec §5 line 63 | index.html `openUpkeep`, Held because row | Upkeep held (drain/park) with no `u.reason` and not by the fleet gives `''`, and `attrRow` then drops the row. Spec line 63 says Held because is "shown when held", so this case drops the row the owner looks for. Show a fallback (for example "no reason given") instead. | |
| T4-3 | Minor | done-when 5 | test/dashboard-overview-goals.test.mjs `the Next chip` | The brief names Reply and Can't right now among the card's parts. They exist only on a secrets card, and the fixture's first question is a plain card, so the test checks choices, textarea, Answer/Send, head and question. The code path is shared (a secrets card is drawn by `questionCard`), so the gap is only in coverage. A secrets-card case would close it. | |

Verdict: APPROVE 6482a313ac0c8012af9b1c80bab21a351ace488c
