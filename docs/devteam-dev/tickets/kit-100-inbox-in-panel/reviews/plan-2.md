# Plan review, pass 2

- Reviewer: reviewer-plan2-k100 (fresh subagent, claude-opus)
- Reviewed: 0db3912908e957e5e796d3260522136a78506f2c (plan.md, the fixes for plan-1)
- Pass-1 findings: P1 to P5 and P7 to P11 are fixed by c19a6c3 as asked. P1: the count is 9 and there are 7 cards. P2: the check waits for `HELD`, and the blur lands the held draw. P3: `inboxFixture` is in `test/lib/kit.mjs`, which is in touches. P4: `#n-questions` is held hidden until T2. P5 (a) to (d): each now has a step and a check. P7: `#settings?th=inbox`. P8: the shots path. P9: `no-shell` is dropped, with an assert. P10: the injected anchor. P11: Post and Done. P6 is fixed, but its new check clashes with T5 (P2-1). Every file named is in touches: the ticket's list plus the nine ruled in.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Important | quality.md §3 (a task's own step must be able to pass); spec §3 order; fix for P6 | plan T4 Step 1 last bullet vs T5 Step 1 ("in order: `q1` choice + rule box + Answer; …") | T4's subtest answers `q1` through the API. T5's subtest runs later on the same fixture and starts by answering `q1` from the panel, but `q1`'s card is gone by then, so T5 Step 4's expected PASS can't happen. Move T4's answered-question check into T5, right after `q1`'s Answer (asserting no pin in `#th-inbox` and `tlInboxHome(Q) === false`), or give it its own question and thread in `inboxFixture`. Keep it in line with spec S2-1. | |
| P2-2 | Minor | spec-1 S2 (a check that fails on broken code) | plan T4 Step 1 ("Goals, made tall by the fixture") | `inboxFixture` has two goals, which won't make Goals scroll at 1440x900. Make the page tall (more goals, or a spacer the test injects), and assert `scrollY === 400` before checking the pin. | |

Verdict: CHANGES 0db3912908e957e5e796d3260522136a78506f2c
