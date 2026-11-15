The Chrome-driven dashboard tests failed most merges on `kit (22, rest)`, and a re-run passed them. CI's logs, including the failed first attempts of re-run runs, show four causes. This fixes each one at the cause and takes fixed sleeps out of the tests that failed.

- **Whole-file cancels** ("Promise resolution is still pending but the event loop has already resolved"): `openChrome().close()` waited on the `exit` of an unref'd Chrome. Once its 3 s SIGKILL timer fired, nothing held the event loop, and node cancelled every test left in the file. `close()` now keeps a timer pending until it ends: SIGKILL at 3 s, then a 5 s bound. A page whose socket closes now fails its waiting calls at once, with a reason. Reproduced deterministically with a SIGSTOPped Chrome: the test fails at main's chrome.mjs with CI's exact error.
- **A teardown that throws first skips the stops** (dashboard-owner-action hung to 600 s): node runs `t.after` hooks in the order they were registered and stops at the first that throws. A new `cleanup(t)` in `test/lib/chrome.mjs` runs the steps last-registered first, each on its own. Every multi-step teardown in `test/dashboard*.test.mjs` uses it (a mechanical conversion, `convert.mjs` in the ticket folder).
- **'ready 5,000 times' drew 3 times**: the page's polls redrew inside the counted window. The page's polls are now held still during the count, and a message round trip replaces the 300 ms sleeps.
- **pane-question 'goes as the key is sent' got 200, not 409**: the test now holds the dashboard's digit with a `tmux` wrapper on that dashboard's PATH. No sleeps, and no delay variable.
- The other fixed sleeps in the named tests (typing, threads, viewer reload) now wait on page state.
- `test/dashboard-teardown.test.mjs` is new. Chrome is gone after a throw, a slow-to-stop Chrome no longer cancels the file, `close()` ends at its bound, a removal that throws skips no stop (checked by pid), and a closed page socket fails its calls.
- `test-stress.yml` takes a `node` input (20, 22 or 24; 24 by default and on a schedule), so the fixes are proven on Node 22, where every failure was.

## How to verify

- `node --test test/dashboard-teardown.test.mjs` on Node 22 or later.
- test-stress runs on this branch: Node 22 and Node 24, 5 repeats, load 2, over every Chrome-driven `test/dashboard*` file and `test/pane-question.answer.test.mjs`. Run ids are in `docs/devteam-dev/tickets/kit-214-steady-chrome-tests/verification.md`.
- test.yml green on every job at the head.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
