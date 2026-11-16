# kit-244 plan

## TL;DR
- Cause: an answered card leaves the Inbox on a later redraw, and if that lands between `p.click`'s measure and its press, Q3 moves up and the press misses the note (spec.md § The cause; reproduced).
- Fix, in `test/dashboard-owner-action.test.mjs` only: after Q is answered, wait until its card has left the Inbox before Q2's clicks; after Q2, the same before Q3's.
- No sleeps or retries are added. Every wait is a `soon` on page state.
- Verify: the file passes locally on Node 22, and four test-stress dispatches (repeat 5, node 22) give 20 passes.
- Mutation: let Done through in the dashboard's gate, and the test fails; reverted and never committed.
- One task, `Model: strong`. It is small, but the edge is subtle.

## Task 1: settle before each card's clicks

- Files: `test/dashboard-owner-action.test.mjs`
- Model: strong (done inline by the worker; a one-place edit)
- Steps:
  1. After `soon(... 'Q answered on the first press')` and its assert, add `await soon(`!${card(Q)}`, 'Q gone from the Inbox')`. Add a comment: p.click measures and presses in two steps, and an answered card leaving above moves the next card between them.
  2. After `soon(... 'Q2 answered')`, add `await soon(`!${card(Q2)}`, 'Q2 gone from the Inbox')`.
  3. Run `evidence/repro.sh` again against the new ordering. Don't expect it to fail the same way: its block still forces the redraw between measure and press. It only shows the mechanism. Record that it is mechanism-only.
  4. Run the file: `/usr/local/bin/node --test --test-concurrency=2 test/dashboard-owner-action.test.mjs`, through `devteam.mjs gate test`, then 3 times locally at `THROTTLE`-free defaults (`nice`).
  5. Mutation: run `evidence/mutate.sh`, which applies `if (false && open.length)`, runs the file, saves the output to `evidence/mutation.txt`, and restores with `git checkout -- docs/devteam/dashboard/index.html`. The expected failure is at 'Done waits…' or 'no answer for three presses of Done'.
  6. Commit and push. Dispatch `gh workflow run test-stress.yml --ref ticket/kit-244-steady-owner-action-test -f files=test/dashboard-owner-action.test.mjs -f repeat=5 -f node=22` four times (they queue in the workflow's concurrency group). Record the run ids and conclusions in verification.md.
- Test: the file's own subtests, the stress runs and the mutation.

## Then

`verification.md` (one row per done-when), merge `origin/main` once kit-87 has merged, the PR, the final review from a fresh reviewer, `check-ticket`, and the merge-request.
