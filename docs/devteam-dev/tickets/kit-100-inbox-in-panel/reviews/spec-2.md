# Spec review, pass 2

- Reviewer: reviewer-spec2-k100 (fresh subagent, claude-opus)
- Reviewed: 0db3912908e957e5e796d3260522136a78506f2c (spec.md, the fixes for spec-1)
- Pass-1 findings: S1 to S6 and S8 to S12 are fixed by c19a6c3 as asked. S1: `tlHome` reads `#th-inbox #questions` only, and AC4 checks it. S2/S3: in-threads pins and cards are fixed, only they are lifted, and they are re-placed on `#th-body` scroll, `transitionend`, a tab change and resize, with checks. S4: the pane draw rule is `!open || selected !== 'inbox'`, with an AC. S5: `tlInboxHome` is owned here and read by `tlInPanel` first. S6: Settings entry. S9: `TL.have > 0`. S10: Escape rule. S11: ruled, §8 and AC9. S12: stated. S7's fixture and order fix brings in the contradiction in S2-1.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S2-1 | Important | quality.md §3 (an acceptance check must be able to pass; no contradiction inside the spec); fix for S7 | spec §3 fixture paragraph ("AC1 to AC4 … run first … AC5 … runs last"), AC4 last bullet, AC5 first bullet | AC4's new last bullet answers `q1` through the API. AC5, which the spec says runs after AC4, then has to "pick a choice and Answer" with the standing-rule box, and the fixture gives that job to `q1` (plan T5 says so outright). By then `q1` is gone, so AC5 cannot run on the fixture as written. AC4 also changes the count before AC5, though the spec says only AC5 does. Fix it one of two ways. Move the "once `q1` is answered" check into AC5, right after `q1`'s Answer (that press answers it through the page), or give that check its own question with its own thread. Then keep the order paragraph true. | |
| S2-2 | Minor | spec-1 S2 (a check that fails on broken code) | spec §3 AC4 ("after `window.scrollTo(0, 400)` on a page tall enough to scroll") | Nothing in the fixture makes the page tall enough to scroll at 1440x900. If it doesn't scroll, `scrollTo` does nothing and the check passes on code with the `scrollY` bug. Assert `scrollY > 0` after the scroll, or name what makes the page tall. | |
| S2-3 | Minor | spec §3 fixture lists every AC's data (spec-1 S7) | spec §3 fixture vs AC4 (`G`) | AC4 uses `G`, "a thread on the goal's card", but the fixture list has only "a goal" and no `G`. The plan has `G` and `goal2`. Add them to the list. | |

Verdict: CHANGES 0db3912908e957e5e796d3260522136a78506f2c
