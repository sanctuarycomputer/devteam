- Reviewer: final-b (fresh subagent of the supervisor, claude-sonnet)
- Reviewed: bd44a9d5e4b48aa7483379e03fcb0e21cea09ce3

| Id | Severity | Rule cited | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Suggestion | none | dashboard/index.html, `ASKS` | An ASKS entry for a question answered elsewhere (CLI) is never cleared; ids are unique so it is never drawn again. Harmless. | wont-fix deferred, Suggestion (supervisor m-20261114-232004765) |

## What I checked and how

- Read spec.md and verification.md first, then the diff (index.html +41/-4, dashboard.test.mjs +123) in review-worktree `b` at the exact sha.
- Ask trigger: `needsWhich` requires a recommendation, non-empty `choicesOf`, kind not goal-approval/review, no secrets. The Answer handler shows the ask only when no choice was passed, nothing is picked (Something else counts as unpicked), no goal id, and the note has words. Nothing posts on that press (early return). Matches the done-whens, including owner-action, proposal and goal-definition cards.
- Posting: a choice sets `picked = chose`, giving "<label> — <words>"; None has value "" and posts the words alone; an emptied note drops the ask and shows "Pick a choice or write an answer."; the rule box, next-time rung and seen hash take the same path as Answer.
- Ask lifecycle: a radio pick calls `dropAsk` (both copies); pressing Answer again re-raises it without duplicating (`querySelector('[data-which-for]')` guard); `questionCard` redraws it only on the copy that raised it ('q' or 't'), so it survives the periodic redraw once. `dropAsk` runs before a real post.
- No regression: questions without a recommendation, a pick plus a note, a pick alone and goal asks fall through to the old path unchanged (`chose === null`, `picked` non-empty or `goalId` set skip the ask).
- Copy: plain words ("Which choice do your words mean?", "None of them", "Post my words as they are."). CSS: no ch units, no max-width cap; the ask fills the card, which carries the existing width rule. The `div` inside the button's span repeats the existing `.choice` pattern.
- Kit purity: only index.html and the test change in code; devteam.mjs untouched; no project names or ids in the diff.
- Ran `node --test --test-name-pattern 'asks which choice' test/dashboard.test.mjs` (env as instructed): 8/8 pass (7 subtests).
- I did not run the full suite; verification.md says this box fails 25 dashboard tests on origin/main too, and CI is the gate for done-when 4.

Verdict: APPROVE bd44a9d5e4b48aa7483379e03fcb0e21cea09ce3
