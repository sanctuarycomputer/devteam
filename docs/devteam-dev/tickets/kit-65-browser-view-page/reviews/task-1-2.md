# Task 1 review, pass 2

- Reviewer: Hopper (fresh subagent, claude-opus-5-5)
- Reviewed: d4badefbe9bdab5076c3ec4fe1028ca69f21aee0 (Task 1 fixes, diff from 2283407)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-8 | Minor | `L-TEST-4` (no flakes) | `test/browser-view-page.test.mjs`, the backoff test | The test asserts wall-clock gaps between upgrade attempts (each gap must fall between 0.8x and 1.3x + 300 ms of 500/1000/2000/4000 ms), and after the reset it asserts the next try comes in under 1400 ms. The bounds are generous and the test passed on every run here (4 full runs under `nice`, concurrency 2). Still, timers in a background Chrome tab on a loaded CI box can be late. Watch it for flakes. If it ever fails, widen only the upper bound, because the lower bound is what catches a missing backoff. | |
| T1-9 | Minor | spec, The address bar / canvas "never below the fold"; `L-TEST-1` | `browser.html` `note()` | The T1-5 fix adds `note()`, which sets `#note` and calls `fit()`. Nothing in T1 calls it and no test covers it, so the fix is untested so far. T2 and T3 will be the first callers. Their tests should check that the canvas bottom stays at or above `innerHeight` once `#note` has text, not only what `#note` says. | |

Pass 1 findings, checked against the diff:

- T1-1: fixed. `MASKED` is now `new RegExp(String.raw\`…\`)`. A new test pulls that literal out of the file and asserts it equals the schema's `x-masked-url` string exactly. The String.raw body has no `${`, so it is the same text. The test then sends five unmasked urls and one masked url with an extra field, then a `held` marker, and asserts `#addr` still shows the earlier masked url.
- T1-2: fixed. A new test measures the four refused tries after a close and the reset to 0.5 s after an open.
- T1-3: fixed. The test asserts `#waiting` is shown with its text before the first frame, and that `#area.down` is set while down and cleared after the reconnect.
- T1-4: fixed. The page has an `opened` flag. A new test refuses the first tries and asserts the chip still says "Connecting…".
- T1-5: fixed in the code (`note()` calls `fit()`). It is untested until T2 and T3 (T1-9).
- T1-6: fixed. `shut()` navigates the tab to about:blank before it closes the CDP socket. The fit test keeps `p` outside the try and shuts it in `finally`.
- T1-7: fixed. "the page has no Done or hand-back control" is now its own test.
- The diff adds nothing else to the page: the script hash is updated and the style is unchanged. The CSP test passes on the committed file.

Mutations tried. Each one ran on a scratch copy of the page with its script and style hashes recomputed (sha256 base64 of the exact text inside its one `<script>` and one `<style>`), against a scratch copy of the test whose `PAGE` points at it, on Node 22:

- M0: no change. 9/9 pass, so the harness is sound.
- M5: `MASKED.test(m.url)` replaced by `true`. Caught: "shows only a masked url" fails (an unmasked url reaches `#addr`).
- M6: `wait = 500` dropped on open. Caught: the backoff test fails ("timed out waiting for connection 3"; the next try waits about 5 s).
- M7: the chip always says "Reconnecting…" on close. Caught: "first socket never opens" fails.
- M8: `closed(m, ['t', 'url'])` dropped. Caught: "shows only a masked url" fails (the url with the extra field is shown).
- M9: `area.classList.add('down')` dropped. Caught: "reconnects" fails.

Verdict: APPROVE d4badefbe9bdab5076c3ec4fe1028ca69f21aee0
