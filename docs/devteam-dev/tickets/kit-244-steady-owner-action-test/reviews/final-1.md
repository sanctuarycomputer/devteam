# Final review, pass 1

- Reviewer: final-reviewer-1 (fresh subagent, claude-opus-5-5)
- Reviewed: 6e802253cb17c3398efaca39eb30a93bdbd964b4 (the whole branch)

Read: the ticket (done_when, touches), `git diff origin/main...HEAD`, and the ticket folder (spec.md with Rulings, plan.md, reviews/plan-1..3 and task-1, verification.md, pr-body.md, evidence/). Main (with kit-87) is not merged in yet. Per m-20261116-075633105-supervisor this is the final review now, and a delta pass follows only if that merge changes the test file. I ran everything in the worker's worktree, which was clean at 6e802253, as the supervisor's brief said, not in a `review-worktree`.

**Footprint.** 16 files change. One is in `touches` (`test/dashboard-owner-action.test.mjs`, +10 lines inside the target subtest). The other 15 are in the ticket folder. No production file changes. `git diff 01fd1ef HEAD` touches only pr-body.md, spec.md (a ruling) and verification.md.

**The cause, checked against the code and the CI log.**
- `p.click` (test/lib/chrome.mjs:116-121) does one `Runtime.evaluate` that calls `scrollIntoView({block:'center'})` and measures the element. Then it sends three separate `Input.dispatchMouseEvent` calls at that point. A layout change between those steps makes the press miss.
- `answerPress` (index.html:4455) has no overlay. Its `apply` calls `markAnswered` (4481), which keeps the `[data-qcard]` element and swaps its innerHTML for the "Answered" note. The card leaves only when `render()` filters `ANSWERED` out of the questions (4703).
- `drawOrHold`/`holding()` (5876, 5898) hold redraws while a press is down or a send is in flight. `pointerup` clears `PRESSED` and calls `drawHeld()`, so a held redraw can land right after any press. In particular, it can land between the next `p.click`'s measure and its press.
- `#goals` sits above `#inbox` on the same page (index.html:792-802), so a redraw of data that lists the answer can also change heights above the cards. That is spec F2's reason to require the count as well.
- CI job 133093504641 (run 43804955902): `not ok 5`, `duration_ms: 20477.9`, `timed out: the note focused`, stack at `dashboard-owner-action.test.mjs:187:5`. Line 187 at main is the `soon(... 'the note focused')` after the textarea's `p.click`. That fits a press that lands on nothing focusable: no throw, then the 20 s `soon` runs out.
- The log can't show which redraw it was. The repro (`evidence/repro-race.txt`) forces the same ordering, and its press lands on "DETAILS Answered (1)". `pr-body.md` § The cause names the cause.

**The fix and its signal.**
- `settled(q, n)` waits for both `!card(q)` and `#answered-sum` === `Answered (n)`. `render()` sets both in one synchronous call (4703-4706). `o.answered` comes from the server only, because `overlaid()` never adds to it and `answerPress` registers no overlay. So the conjunction holds only after a draw of data that lists the answer.
- `n0` is read inside the subtest. No earlier subtest posts `/api/answer`, so it is the true base.
- After `settled(Q2, n0+2)`, nothing above Q3 waits on a later read:
  - Q and Q2 are gone.
  - Goals is drawn from the same data.
  - `#answered-wrap` is below Q3, and only its summary text changes.
  - Q3's own changes are synchronous within its presses or awaited: the pick, the marks waited on by `'not done yet'`, and the marks removed, which is asserted at once.
  - A later forced `load` in `press()` draws through `drawOrHold` without force, and focus holds it.
- So the fix closes every coordinate click on Q2 and Q3, including the failing textarea click. Q's own two clicks are not preceded by a settle (S1 below).

**Done-when 1 (no timer; page signals).**
- The diff adds only `soon` waits on DOM state. It adds no `setTimeout`, sleep, retry or longer bound. The only `setTimeout` in the file is `soonIn`'s existing 50 ms poll at l.36.
- The note and the records are still waited on through `document.activeElement` (l.197) and the `Done: …` texts (l.176).

**Done-when 2 (20 repeats on Node 22). Derived from the four runs' own logs:**

| Run | Head | Conclusion | Inputs | Per repeat |
|---|---|---|---|---|
| 43826419937 | 8636a1fb6871d28f54b601658f5cf0642399e093 | success | FILES test/dashboard-owner-action.test.mjs, REPEAT 5, NODE 22 (v22.23.4), LOAD 0 | 5× `# pass 6 / # fail 0 / # skipped 0`, 5× `ok 5 - Done goes through…` |
| 43826595672 | 8636a1fb6871d28f54b601658f5cf0642399e093 | success | same | same |
| 43826814063 | 01fd1ef05cfcad4138a92db0cb17145751882d0f | success | same | same |
| 43826989988 | 01fd1ef05cfcad4138a92db0cb17145751882d0f | success | same | same |

- Each log ends "All 1 file passed on every repeat.", which makes 20 of 20.
- `git diff 8636a1f 01fd1ef -- test/` changes only the four comment lines (T1-2's rewording).
- `git diff 01fd1ef 6e80225 -- test/` is empty. So the test code that ran in all four is the code at head.

**Done-when 3 (mutation).**
- I ran `sh …/evidence/mutate.sh` once.
- Mutated gate: `if (open.length && !/look at one rule/.test(qv.question))`.
- Result: subtests 1-4 ok, `not ok 5 - Done goes through…`, `timed out: not done yet`, `# pass 4 / # fail 2`.
- Afterwards `git status --porcelain` was empty. The dashboard was restored, and the rewritten `mutation.txt` matched the committed one byte for byte.

**Run at head.**
- Command: `timeout 300 /usr/local/bin/node --test --test-concurrency=2 test/dashboard-owner-action.test.mjs`.
- Result: pass 6, fail 0, skipped 0. Subtest 5 took 6011 ms locally (777-978 ms on the stress runner).

**check-ticket** with the PR title and pr-body.md fails only on the two lines this record addresses: "no final review record (reviews/final-<n>.md)" and "needs 1 final APPROVE review(s) at this head … found 0". It reported nothing else.

**CI on the head.**
- test.yml run 43827394485 (pull_request, head 6e80225) was `in_progress` when I checked.
- An earlier run, 43827314692, was cancelled by its concurrency group.
- The supervisor checks CI at merge, after main is merged in.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S1 | Suggestion | none (no rule cited) | test/dashboard-owner-action.test.mjs:177-178 | Q's own two `p.click`s have no settle before them. Subtest 4's goal and knowledge presses (GB's hold bar last) can still be read back from the server after `'every record of Q done'`. I found no mover for them: those presses draw through overlays (`holdOverlay`) or peeks at the press, and no answered card sits above Q. That is why this isn't a finding, but the subtest's first two clicks rest on that reasoning rather than on a page signal. | |
| S2 | Suggestion | none (no rule cited) | verification.md row 2 | The four stress runs are at `load=0`, while the CI flake came under the full Chrome shard's load. Done-when 2 asks for no load, so this is met. The deterministic race repro (`evidence/repro-race.txt` vs `repro-fixed.txt`) is the stronger evidence that the ordering is fixed, and the PR could say so in one line. | |

Verdict: APPROVE 6e802253cb17c3398efaca39eb30a93bdbd964b4
