# Spec review, pass 2

- Reviewer: spec-plan-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: 70c0094a4e88b9ccda396ef9dc0eeba6801fbb0f (spec.md, diff since 003d993)

Earlier findings:

- F1-1: fixed. The count is asserted after the first `coverage()` and again at the end of the test, and the count patch turns off both `globCache` and `matcherCache`. I checked the claim in the code: `ownersOf` calls `compileLines` on every call (devteam.mjs, coverage block), so with both caches off the 900 asks compile about 27,000 regexes, and the end count cannot stay at 31.
- F1-2: fixed. The new B2b is a same-process ratio of the 5,000 `suggest()` lookups against a plain-Map walk written in the test, the answers are asserted equal first, and acceptance 3 now names the lookup patch.
- F1-3: fixed. The fixture grows to 2,000 questions and the bound moves to 4.5. The margins are restated with real figures, and I checked the arithmetic: 4.5/2.63 = 1.7, 8.3/4.5 = 1.84, 10/5.6 = 1.8, 24/10 = 2.4, 8/4.8 = 1.67, 20/8 = 2.5. The B3 edge case says plainly that `inboxRanks` made 10x slower by itself moves the ratio only to about 3.6, under the bound. It says the bound and its 10x patch cover the command's read, fold and rank beyond reading the log, and that this reading goes to the supervisor. That is stated honestly. The patch's `questionsNow()` does skip the `questions` memo. The raw log parse (`readLog`) still runs once, which matches "beyond reading the log". Whether this reading of done-when 3 is acceptable is the supervisor's call.
- F1-4: fixed. Check 5 now also requires that no process has the dashboard's pid as its pgid and that no watcher names that pid.
- F1-5: fixed. A second patch makes the first step throw, and the stop and the folder removal are shown to still run.
- F1-6: fixed. The new edge case "What B5 rests on" covers both the 30 s versus 60 s order and the old `send-keys` case.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | spec and plan agree | spec.md:24 (B1 row), spec.md:50 (edge case) | The spec says the end count follows "six more `coverage()` runs". The plan (plan.md:46) says it follows "the five ratio runs" (`ratio(run, ref, 5)`), which makes six in all counting the first call. Make the two say the same thing. The property holds either way. | |

Values and refusals (strategy.md): unchanged from pass 1. This is a test-only change. It touches no rung, owner-facing message, question or authority.

Verdict: APPROVE 70c0094a4e88b9ccda396ef9dc0eeba6801fbb0f
