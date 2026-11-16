# kit-244 spec: the owner-action Chrome test waits on the page, not a timer

Ticket: `kit-244-steady-owner-action-test` (chore, S, risk normal). Touches: `test/dashboard-owner-action.test.mjs`.
Supervisor's word (m-20261116-072003301-supervisor): small and on the critical path; tight spec and plan, one combined spec+plan review; build once kit-87 merges.

## The cause (found, reproduced at main e2e19105)

`'Done goes through once every record is done; never while one is unchanged'` answers Q, then Q2, then works Q3 with coordinate clicks (`p.click` in `test/lib/chrome.mjs`). `p.click` is two CDP steps: one `Runtime.evaluate` scrolls the element to the middle and measures it, and separate `Input.dispatchMouseEvent` calls press at that point later.

An answered question's card does not leave the Inbox when it is answered. `answerPress`'s `apply` calls `markAnswered` at the press, before the request goes out, and that swaps the card for a short "Answered: …" note. The card goes only on a later redraw, from the next `/api/data` read that no longer lists the question, and only once the page stops holding redraws (a press within `PRESS_HOLD`, a send in flight). In a local trace that removal came about 0.7 s after Q3's Send press, just before the "Can't right now" and note clicks. Both cards sit above Q3, so when they go, Q3 moves up the page by their height (143 px in the repro).

When that redraw falls between `p.click`'s measure and its press, the press lands below the note. In the repro it lands on the Inbox's "Answered (1)" section. Nothing is focused, nothing throws, and `soon(... 'the note focused')` waits its 20 s and fails with `timed out: the note focused`. That is the CI failure (run 43804955902 attempt 1, job 133093504641: subtest 5 took 20478 ms and failed at line 187). The same race can hit Q2's clicks, when Q's note leaves above it. Q3's "Done", Send and "Can't right now" clicks are exposed as well. (The shrink to the note isn't a race: it happens inside the Send press, before the test measures the next card.) Any later height change above the Inbox moves Q3 the same way. The Goals section is drawn from the server's open questions, and Q and Q2 serve goal GQ, so it can redraw on a later read too. That means the cards leaving is not enough on its own (plan review F2).

Repro: `evidence/repro-race.test.mjs.txt`, run with `evidence/repro.sh`. It holds `/api/data` reads from Q's Done press on, so the answered cards stay up. It measures the note the way `p.click` does, lets the reads go, waits for the cards to leave, then presses at the point it measured. Output at main: `evidence/repro-race.txt`, which shows `timed out: the note focused`, the note moved from y≈450 to 307–364, and the point now on "DETAILS Answered (1)".

## Approaches

1. **Wait for the page to settle before each coordinate click (chosen).** After each answer, wait until the page has drawn data in which the server lists that question as answered. That is two page signals together: the Inbox's `#answered-sum` reads one more than before (`Answered (n0+1)`, then `n0+2`; it is drawn from the server's `answered` list), and that card has left the Inbox (`!card(Q)`, then `!card(Q2)`). Both come from one `render()` of data that already has the answer, so every section drawn from that data (the Goals section's GQ included) is drawn too. Later reads bring the same data, and nothing above Q3 changes height. Q3's own marks appear and go inside its rows: they come from its own presses and appear before the next measure (the test already waits on them, or they are synchronous).
2. Retry the click until the note is focused. This hides any future layout bug and is a timer in disguise. Rejected.
3. Change `p.click` (`test/lib/chrome.mjs`) to measure and press atomically, or to re-measure after the press. That is outside `touches`, and CDP can't make the measure and the press one step. Rejected.
4. Focus the note with `el.focus()` from `p.ev` instead of a click. That stops testing what the owner does. Rejected.

## Acceptance checks (the done-whens, restated)

1. In the test, Q2's clicks wait until the page has drawn Q answered by the server (`Answered (n0+1)` and Q's card gone). Q3's clicks wait the same way for Q2. Both waits read the page's DOM, never a sleep. The note and the record are still waited for through the page's own signals (`document.activeElement`, the `Done: …` texts). The test adds no fixed `setTimeout` or sleep. The PR names the cause above.
2. test-stress.yml, dispatched on the ticket branch with `files=test/dashboard-owner-action.test.mjs`, `node=22`, has 20 passing runs, linked in the PR. The workflow takes `repeat` from 1 to 5 only, so this is four completed dispatches of `repeat=5` (my call; that file is outside touches). The workflow's concurrency group cancels a pending run when a newer one queues, so each run is dispatched only after the one before it has finished (plan review F3). verification.md lists the four run ids.
3. A mutation that lets Done through while a record is unchanged makes the test fail. The mutation skips the dashboard's Done gate (`docs/devteam/dashboard/index.html` ~l.6262) for Q3 only: `if (open.length && !/look at one rule/.test(qv.question))`. Scoped like that, the earlier subtests still hold Q's Done, and the target subtest is the first to meet the mutation (plan review 2, G1). The diff and the failing output go in the PR. It is applied to the working tree only and reverted, never committed. The PR shows the target subtest's own `not ok` line. Under this mutation it fails at l.180, `timed out: not done yet` (plan review F6, G1).

## Contracts

None provided or consumed. Test-only change.

## Edge cases

- The redraw that removes Q's card is held while a press is recent. The wait has the usual bound of 20 s, and that bound only matters when something is broken.
- The answered note is drawn on both copies (Inbox and thread). The test is on `#questions`, and `card()` reads the Inbox copy only.

## Out of scope

`test/lib/chrome.mjs` (`p.click` itself), the dashboard's hold and redraw behaviour, and other files' flakes. The 'rmSync ENOTEMPTY' after-hook flake (o-20261115-192324709) was kit-214's.

## Plan review 1 (CHANGES at 710deb9)

F1: the shrink's timing is corrected above. F2: the stronger page signal is in approach 1. F3 and F6: in the acceptance checks. F4 and F5: in plan.md. Review 2 (CHANGES at ed092b8): G1, the mutation is scoped to Q3 (above). G2 and G3: `evidence/repro.sh [race|fixed]` and `evidence/mutate.sh` write their evidence files.

## Rulings

- m-20261116-072003301-supervisor: tight spec and plan, one combined review, build after kit-87 merges.

- m-20261116-074413911-supervisor: approve-spec and approve-plan at c2a98f5; build now on this branch, merge main in once kit-87 merges, then CI and finals.
