# Spec review, pass 4

- Reviewer: spec-plan-reviewer-4 (fresh subagent, claude-opus-5-5)
- Reviewed: 99137f40559156803c573161835d0b696d2f544c (spec.md, diff since dc3b6c1)

Checked against spec-3's finding and plan.md at the same head. Nothing was run.

- F3-1: fixed. The no-exit case now checks that `close()` resolves in at least 6 s and under 10 s, with the reason stated (an exit ends it at about 3 s, the bound at about 8 s). 6 s separates the two outcomes with about 2 s of room on each side, so early-firing timers no longer fail it. Plan Task 1 step 1 states the same window and reason.
- P3-2 carried into spec § pane-question: the `gave-up` check sits right after the first answer comes back, before any assert on its status. Plan Task 4 step 1 says the same (\"right after await answering, before the status asserts\").
- The diff adds no authority path, input or new behaviour; values and refusals (strategy.md) unchanged since spec-1.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F4-1 | Minor | spec § lib/chrome.mjs (the F3-1 edit) | spec.md:50 (\"the lower bound sits clear of the 8 s mark (F3-1).  and the parent checks\") | An editing leftover: a full stop, a double space and a lowercase \"and\" start a fragment. The meaning still reads (the parent checks the file ended by itself with nothing cancelled), so it does not block. Join it to the previous sentence or start a new one (\"The parent checks ...\"). | |

Verdict: APPROVE 99137f40559156803c573161835d0b696d2f544c
