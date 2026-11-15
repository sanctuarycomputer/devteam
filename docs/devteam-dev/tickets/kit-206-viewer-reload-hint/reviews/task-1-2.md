# Task 1 review, pass 2

- Reviewer: task-reviewer 2 (fresh subagent, claude-opus)
- Reviewed: 7f62d296b5cb8f837d8e49828ec14fd719bd10c5 (task 1 fixes)

**Summary.** A cold, diff-only check of `git diff 21ee88e 7f62d29` against T1-1..T1-3 in `reviews/task-1.md`. In a `git archive` copy of 7f62d29 the new test passes (3/3, about 46 s). Pass 1's two mutations, re-run in scratch copies:

- **T1-1 holds.** Mutation 1 (no open-time `fpNow: fp, mainFpNow: mainFp`, and an unguarded copy of `fpNow` into `fp` on reload) now fails the viewer-tab subtest ("timed out: the outline, within a poll"). That subtest presses reload after `'v1'` arrives a second time and asserts only boot's `/api/view?` has been asked, so the press is shown to come before the tab's first check; a check that fired early would fail the test, not let it pass. The dashboard comment now says what that press there really shows, and it is accurate.
- **T1-2 holds.** Mutation 2 (the frame reloads itself 1.5 s after the hint) now fails both subtests on the 3 s wait and second "nothing reloaded by itself" check (`1 !== 0`).
- **T1-3** (240000 timeout) was a Suggestion; keeping it, noted in verification.md, is acceptable.

Nothing else in the diff touches task 1's code.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

None.

Verdict: APPROVE 7f62d296b5cb8f837d8e49828ec14fd719bd10c5
