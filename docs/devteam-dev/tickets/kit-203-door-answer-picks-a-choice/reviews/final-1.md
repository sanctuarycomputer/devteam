# Final review, pass 1 (track A)

- Reviewer: final-a (fresh subagent of the supervisor, claude-opus)
- Reviewed: bd44a9d5e4b48aa7483379e03fcb0e21cea09ce3 (the whole branch, kit PR #240)

| Id | Severity | Rule cited | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | project/playbook.md:12 ("make sure the PR says in one line what it doesn't defend against") | PR #240 body | The PR body has no line saying what this doesn't defend against. spec.md has a "Known limits" section (an owner who picks a choice their words contradict; a label holding " — " never matches; the Recommended tag still nudges), but the PR body doesn't carry it. Fix: add one line to the PR body. No code change, so the head stays the same. | fixed in the PR body (the Doesn't defend against line) |
| F2 | Minor | plan.md Review focus 5; quality.md §3 (mutate where a test can't prove it) | test/dashboard.test.mjs, new test | No test uses a label holding `"`, `<`, `&` or `'`. If I drop `esc` from the ask button's `value` (scratch mutation M3), all 8 tests still pass, yet the posted label is cut short at the quote. The code at this head is correct: a scratch subtest with ``Say "yes" <b>bold</b> & 'it' &amp;`` posted exactly `<label> — fine`, matched, with no injected markup. That subtest fails under M3. | wont-fix deferred, Minor (supervisor m-20261114-232004765) |
| F3 | Minor | spec "What changes" (a refused post brings the card back without the ask) | index.html `dropAsk(id)` before the post; test | No test covers a refused post from the ask. If I remove the `dropAsk(id)` before the post (M6), all tests still pass, and a refusal would then bring the ask back on the Inbox redraw. The behaviour is correct by reading: ASKS is cleared before `answerPress`, and `cardFields` restores the pick from before the ask, because the ask never sets `picks`. | wont-fix deferred, Minor (supervisor m-20261114-232004765) |
| F4 | Minor | spec Edge cases (choices but no recommendation: unchanged) | `needsWhich`; test | No test covers a question with choices but no recommendation. If I drop `!!q.recommendation &&` (M7), all tests still pass. The code is correct by reading. | wont-fix deferred, Minor (supervisor m-20261114-232004765) |

## What I checked and how

- **Scope.** I ran `git diff --stat origin/main...bd44a9d`. The only code changes are `docs/devteam/dashboard/index.html` (+41/-4) and `test/dashboard.test.mjs` (+123). The rest is this ticket's records. `docs/devteam/scripts/devteam.mjs` has no diff, so `questionView`'s `matched` and `doorAgreed` are unchanged. The supervisor gains no way to mark a typed answer as matched. The only new way to post a label is the owner pressing a button on the card.
- **Authority, by reading the click handler and `questionCard`:**
  - **Labels come from the question.** The ask's buttons are drawn only from `choicesOf(q)` of the same question. `data-which` and `data-which-for` are keyed by the escaped id, and `CSS.escape` is used in `dropAsk`. The posted label is `btn.value` of the button pressed, and the note comes from that button's own card (`qcardOf(btn)`). A stale ASKS entry can't carry another question's label: entries are keyed per id, the label always comes from the pressed button, and a question that has left `DATA` gives `needsWhich(undefined)` false, which leads to the ordinary post.
  - **A redraw can't move the ask to another copy.** `questionCard` draws the ask only when `ASKS[id]` equals that copy's letter. Raising the ask on one copy removes it from the other, and a radio pick on either copy removes it everywhere.
  - **No empty answer can be posted.** A choice pressed with the note trimmed empty returns before posting, with the existing error. On the Answer path, the existing `!answer` check still applies.
  - **Card kinds.** Goal approval is excluded (`needsWhich` and `!goalId`), and so are reviews (their own card) and secrets cards (no `data-answer` button).
  - **No other handler intercepts.** No branch earlier in the handler catches `button[data-which]`, and nothing else triggers `data-answer`.
  - **Odd labels.** `esc` escapes `& < > " '`, so a label with quotes or HTML round-trips through `value`. I confirmed this in Chrome with a scratch subtest (F2).
  - **A rewritten button value** would take a forged DOM edit, which strategy P6 puts out of scope.
- **Refused post.** ASKS is deleted before `answerPress`, and `putBackCard` restores the pre-ask `picks` and the note. This is correct by reading but untested (F3).
- **Tests.** I ran the new test at this head with the required env prefix and the `asks which choice` pattern: 8/8 pass. Scratch mutations, in a copy under the scratchpad, each run against the new test:
  - M1, ignoring the pressed choice: subtest 4 fails.
  - M2, removing the empty-note guard: subtests 6 and 7 fail.
  - M4, a radio pick that keeps the ask: subtest 3 fails.
  - M5, the ask always on the Inbox copy: subtest 7 fails.
  - M8, two asks across copies: subtest 7 fails.
  - M3 (unescaped value), M6 (no drop before the post) and M7 (no recommendation needed) survive (F2 to F4).
- **CI.** `gh pr checks 240`: 6 of 8 jobs pass, and kit (20, rest) and kit (22, rest) were still pending when I looked. The supervisor should confirm all 8 are green before the merge (done-when 4).
- **The PR body.** It describes the change and how to verify it, but has no line on what it doesn't defend against (F1).

Verdict: CHANGES bd44a9d5e4b48aa7483379e03fcb0e21cea09ce3
