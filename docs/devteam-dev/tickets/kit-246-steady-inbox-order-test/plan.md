# kit-246 plan

## TL;DR
- Cause: the goal drawer is drawn before the goal's record arrives and again when it lands; the record's rows push "Wrong?" down, and if that lands between `p.click`'s measure and its press, the press misses, no correction is sent, and the server read times out (spec.md § The cause; reproduced).
- Fix, in `test/next-step.strategy.test.mjs` only: wait for the drawer drawn with its record before "Wrong?"; wait for the form open with its field focused before setting values and Send; wait for `Correction sent` or `Change it` before the server read.
- No sleeps or retries. Every wait is a `soon` on page state.
- Verify: the file passes locally on Node 22 through the gate; four test-stress dispatches (repeat 5, node 24), each after the one before finished, give 20 passes; a fifth with `load=2`.
- Mutation: the dashboard draws the Inbox's questions reversed; the target subtest fails at its order assert. Reverted, never committed.
- One task, `Model: strong`, done inline by the worker (a one-place edit whose edge is subtle).

## Task 1: wait on the drawer's own signals

- Files: `test/next-step.strategy.test.mjs`
- Model: strong (inline)
- Steps:
  1. Replace `await soon(… data-correct …, 'the goal drawer')` with a wait for the button and the record together: `!!document.querySelector('[data-correct="${key}"]') && !!document.querySelector('#drawer-body .hist-h') && !document.querySelector('#drawer-body .loading')`, named `'the goal drawer with its record'`. A comment above it says why: the drawer is drawn at once and again when the goal's record lands, which adds its rows above Wrong?, and `p.click` measures and presses in two steps. It names both halves of the signal: `.loading` gone, and `.hist-h` present, which a failed load doesn't draw (F6).
  2. After `p.click` on Wrong?: `await soon(\`document.activeElement === document.querySelector('input[data-reason="${key}"]')\`, 'the correction form open')`. A short comment: the click's effect, and the focus is what holds the drawer's redraws from here on.
  3. After `p.click` on Send: `await soon(\`!!document.querySelector('[data-correct-sent="${key}"]') || document.querySelector('[data-correct="${key}"]')?.textContent === 'Change it'\`, 'Correction sent')`, with a comment that a refresh after the server has it redraws the drawer without the note (F1). Then the existing server `until`.
  4. Evidence for the cause: `sh evidence/repro.sh race` and `sh evidence/repro.sh fixed` were run at main's test (4f4ab43). The race variant shows the flake in main's order; the fixed variant shows the press landing once the record is drawn, which is the first new wait. The second and third waits are covered by the test's own runs (F4). Neither repro is re-run against the edited test: the repro is a standalone file.
  5. Gate: `node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test -- timeout 900 /usr/local/bin/node --test --test-concurrency=2 test/next-step.strategy.test.mjs`, three times.
  6. Mutation: `sh evidence/mutate.sh` reverses the Inbox's drawn order (dashboard l.5292, `d.questions.map(` → `[...d.questions].reverse().map(`; the script refuses if the line is not found once or the file has local changes, and restores it on exit, INT, TERM or HUP), runs the file once, and writes the diff and the `ok`/`not ok`/`error:` lines to `evidence/mutation.txt`. Expected: subtests 1–5 ok, `not ok 6`, at the order assert. Then `git status --short` must show no change to the dashboard and nothing new under `test/` (F3).
  7. Commit and push. Dispatch `gh workflow run test-stress.yml --ref ticket/kit-246-steady-inbox-order-test -f files=test/next-step.strategy.test.mjs -f repeat=5 -f node=24` four times, each after the one before has finished, then once more with `-f load=2`. Record the run ids and conclusions in verification.md.
- Test: the file's own subtests, the stress runs and the mutation.

## Then

`verification.md` (a row per done-when), merge `origin/main`, re-run the gate, the PR (body names the cause, links the stress runs and shows the mutation), CI green at the head, the final review from a fresh reviewer, `check-ticket`, the merge-request. An observation on the dashboard's drawer redraw not holding for a recent press (spec approach 3), and one on `until`'s bound being polls, not time.
