# kit-244 plan

## TL;DR
- Cause: an answered card leaves the Inbox on a later redraw, and if that lands between `p.click`'s measure and its press, Q3 moves up and the press misses the note (spec.md § The cause; reproduced).
- Fix, in `test/dashboard-owner-action.test.mjs` only: after Q is answered, wait until the page has drawn it answered by the server (`#answered-sum` one up, and Q's card gone) before Q2's clicks. After Q2, the same before Q3's.
- No sleeps or retries are added. Every wait is a `soon` on page state.
- Verify: the file passes locally on Node 22. Four test-stress dispatches (repeat 5, node 22), each sent after the one before has finished, give 20 passes.
- Mutation: let Done through in the dashboard's gate, and the test fails; reverted and never committed.
- One task, `Model: strong`. It is small, but the edge is subtle.

## Task 1: settle before each card's clicks

- Files: `test/dashboard-owner-action.test.mjs`
- Model: strong (done inline by the worker; a one-place edit)
- Steps:
  1. At the subtest's start, read `n0` = the count in `#answered-sum` (`/\((\d+)\)/`, 0 if absent). Add a helper `settled(q, n)` = `soon(`!${card(q)} && document.getElementById('answered-sum')?.textContent === 'Answered (${n})'`, ...)`. Add a comment: p.click measures and presses in two steps, and an answered card leaving (or anything above redrawn from the server's answer) moves the next card between them.
  2. After Q's answer and its assert, `await settled(Q, n0 + 1)`. After `soon(... 'Q2 answered')`, `await settled(Q2, n0 + 2)`.
  3. Fixed-ordering repro (F4): `evidence/repro-fixed.test.mjs.txt`, run by `sh evidence/repro.sh fixed` (the script takes `race|fixed`, then node, and writes `evidence/repro-<variant>.txt`; G2, G3). It is the same blocked-reads repro, but it lets the reads go and waits for `settled` *before* measuring, as the fixed test does. The press then lands on the note, the subtest passes, and the script writes the output to `evidence/repro-fixed.txt`.
  4. Run the file through the gate: `node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test -- timeout 300 /usr/local/bin/node --test --test-concurrency=2 test/dashboard-owner-action.test.mjs`, then twice more the same way.
  5. Mutation: run `evidence/mutate.sh`, which skips the Done gate for Q3 only (`if (open.length && !/look at one rule/.test(qv.question))`, G1), runs the file, writes the diff and results to `evidence/mutation.txt` (G3), and restores with `git checkout -- docs/devteam/dashboard/index.html`. The expected failure: the target subtest's `not ok`, at l.180 `timed out: not done yet` (F6). The earlier subtests pass.
  6. Commit and push. Dispatch `gh workflow run test-stress.yml --ref ticket/kit-244-steady-owner-action-test -f files=test/dashboard-owner-action.test.mjs -f repeat=5 -f node=22` four times, each after the one before has finished: a newer dispatch cancels a pending one in the concurrency group (F3). Record the run ids and conclusions in verification.md.
- Test: the file's own subtests, the stress runs and the mutation.

## Then

`verification.md` (one row per done-when), merge `origin/main` once kit-87 has merged, the PR, the final review from a fresh reviewer, `check-ticket`, and the merge-request.
