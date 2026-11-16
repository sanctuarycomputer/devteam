# kit-246 spec: the Inbox-order browser test waits on the page's own signal

Ticket: `kit-246-steady-inbox-order-test` (chore, S, risk normal). Touches: `test/next-step.strategy.test.mjs`.
Supervisor's word (m-20261116-163453784-supervisor): full review depth; reproduce the flake, fix it on the page's own signal as kit-244 did, stress ×20, mutation.

## The failure

main run 43904665122, attempt 1, job 133430167953 (`kit (24, chrome 1/2)`): `not ok 6 - the Inbox shows the order: …`, `timed out waiting for the owner's value` at l.272, the `until` after the goal drawer's correction. The subtest took 251 s (a loaded runner: `until` is 1200 polls of 100 ms plus a CLI spawn each, so it gives up after minutes, not 2 min). The rerun passed.

## The cause (found, reproduced at main 5bd501b)

The subtest opens the goal drawer (`#goal/<G>`) and waits only for the "Wrong?" button (`[data-correct="imp:<D>"]`) to exist. It then clicks it with `p.click` (`test/lib/chrome.mjs`), which is two CDP steps: one `Runtime.evaluate` scrolls the button to the middle and measures it, and later `Input.dispatchMouseEvent` presses at that point.

The goal drawer is drawn twice. `openGoal` draws it at once from the data the page has, while the goal's record (`peekOf('goal', G)`, a `/api/peek` request that spawns the kit's CLI on the server) is still on its way. With no record, `attrs` draws one `… loading` row, and `historySection` draws `History` and `Loading…`. When the peek lands, `fetchPeek` calls `redraw()`, and the drawer is drawn again with the record's stored rows and its `Created` / `Last changed` rows. They sit in the `<dl>` above the "Computed" list that holds "Why it matters" and "Wrong?". So the button moves down by those rows (about 250 px in the repro). That redraw isn't held by a recent press: `redraw()` is gated only by `busyDrawer()` (focus in a field of the drawer, or a confirm), never by `holding()`.

When the peek lands between `p.click`'s measure and its press, the press lands on one of the new rows. The form stays hidden. The test then sets the select and the reason on the hidden form (that works), and `p.click` on the hidden Send measures a 0×0 box and presses at nothing. No correction is sent, so `goal show` keeps level 3 and `until(… 'the owner\'s value')` times out. That is the CI failure. On a loaded runner the peek (a CLI spawn) is slow enough to land anywhere in that window. The same redraw between the press and the release also loses the click, since the release lands on a new element.

Repro: `evidence/repro.test.mjs.txt`, run by `evidence/repro.sh race|fixed`. It holds the page's `/api/peek` answers (a wrapper on `window.fetch`) from before the drawer opens. The race variant measures "Wrong?" as `p.click` does, lets the peek go, waits for the record to be drawn, then presses at the measured point (`p.clickAt`). Output in `evidence/repro-race.txt`: measured at y≈246, the button is at y≈494 at press time, the point is on the `Created` row's `DD` ("… by the supervisor"), the form is still hidden after the press, and the subtest fails with `timed out waiting for the owner's value`. The fixed variant waits for the record first, then measures; the press lands on "Wrong?" and the subtest passes (`evidence/repro-fixed.txt`).

## Approaches

1. **Wait for the drawer to be drawn with the goal's record, then for each click's own effect (chosen).**
   - Before "Wrong?": wait until the drawer has the record: `#drawer-body .hist-h` is there and no `#drawer-body .loading` is left. Both come from one `openGoal` draw with the peek, so the rows above the button are in place. A peek that failed (transient) draws no `.hist-h`, so the wait holds until a later refresh brings it. Later redraws from refreshes draw the same rows, so nothing above the button changes height.
   - After "Wrong?": wait until the form is open and its reason field has focus (`document.activeElement` is `input[data-reason="<key>"]`). That is the click's own effect. The focus is also what holds the drawer from now on: `busyDrawer()` refuses a `redraw()` while a field in the drawer has focus, and `holding()` holds the page's redraws while a text field has focus. So the values the test sets stay, and the form stays open.
   - After Send: wait for the page to show the press went: its `Correction sent` note (`[data-correct-sent="<key>"]`, drawn by the press's `apply`) or, once the server has the correction and a refresh has redrawn the drawer (which removes the note, since it was inserted outside the drawer's HTML), the button now reading `Change it` (the owner's own value). Either one says the press was taken (review 1, F1). Then wait for the server's value as before. A lost Send press fails with its own message (`Correction sent`) rather than on the server value; the bound is the same `until` (review 1, F2).
2. Retry the click until the form opens. That hides any future layout bug, and it is a timer in disguise. Rejected.
3. Change `p.click` to measure and press as one step, or change the dashboard to hold `redraw()` on a recent press. Both are outside `touches`. CDP can't make the measure and the press one step. The dashboard change may be worth having, since an owner's click could miss the same way, but a person sees the drawer move and a test can't. It is offered to the supervisor as an observation, not done here. Rejected for this ticket.
4. Open the form with `el.click()` or `.hidden = false` from `p.ev`. That stops testing what the owner does. Rejected.

## Acceptance checks (the done-whens, restated)

1. The subtest waits for the page state it needs through the page's own signals: the record drawn in the drawer before "Wrong?" (`.loading` gone and `.hist-h` present: `.hist-h` alone is drawn in the loading state too, and it is what tells a loaded record from a failed one), the form open with its field focused before the values and Send, and `Correction sent` or `Change it` before the server read. No fixed `setTimeout` or sleep is added, and no retry. The PR names the cause above.
2. test-stress.yml, dispatched on the ticket branch with `files=test/next-step.strategy.test.mjs`, `node=24`, has 20 passing runs, linked in the PR. The workflow takes `repeat` 1 to 5 only, so this is four completed dispatches of `repeat=5`, each sent after the one before has finished (the workflow's concurrency group cancels a pending run when a newer one queues; kit-244's F3). verification.md lists the four run ids. The CI failure came under load, so a fifth dispatch adds `load=2` (two CPU burners beside the test; review 1, F5). Its result is recorded either way; the deterministic race repro remains the stronger evidence for the cause.
3. With the Inbox order broken, the test fails. The mutation reverses the order the dashboard draws the Inbox's questions in (`render()`, `d.questions.map(…)` → `[...d.questions].reverse().map(…)`, docs/devteam/dashboard/index.html). The target subtest's own `not ok` line shows, failing at the order assert (l.252, `the kit's order, and the lesson to keep after the questions`). The CLI's `next` subtest doesn't read the dashboard and still passes. The mutation is applied to the working tree only, by `evidence/mutate.sh`, and reverted; never committed. The diff and the output go in `evidence/mutation.txt` and the PR.

## Contracts

None provided or consumed. A test-only change.

## Edge cases

- The peek fails for a while (`could not load it just now`): no `.hist-h`, so the wait holds until a refresh's peek succeeds, up to `until`'s bound. Only a broken server reaches the bound.
- The reason field's focus is what holds redraws. `p.ev` sets `.value` without moving focus, so the hold stands until Send's press moves it.
- Send's press moves focus to the button, so `busyDrawer()` stops holding. A peek fetched by a refresh before the field took focus could still land between Send's press and release. With the record already drawn that redraw draws the same HTML, and `showDrawer` leaves the drawer as it is (`html === LAST_HTML`). It would differ only if a relative time in the drawer changed its words in that instant. The drawer's times are absolute (review 1 checked), so that redraw draws the same HTML and is skipped. The `Correction sent` wait names it if it ever happens.

## Spec and plan review 1 (CHANGES at 4f4ab43)

F1: the Send wait takes the note or `Change it` (above). F2: reworded (above). F3: `repro.sh` and `mutate.sh` clean up on INT, TERM and HUP too, and the plan checks the tree is clean after each. F4: the plan says what the repros show (the race at main's order; the fixed variant covers the first wait only; the test run covers the rest). F5: a fifth, loaded stress dispatch (above). F6: the code comment names both halves of the record signal.

## Out of scope

`test/lib/chrome.mjs`, the dashboard's redraw rules (approach 3), `until`'s bound counting polls rather than time (an observation), and other files' flakes (kit-245 is the gateway's).

## Rulings

- m-20261116-163453784-supervisor: full review depth (the trial's comparison half); reproduce, fix on the page's own signal as kit-244 did, stress ×20, mutation.
- m-20261116-170723373-supervisor: approve-spec and approve-plan at 06d6637. Build.
