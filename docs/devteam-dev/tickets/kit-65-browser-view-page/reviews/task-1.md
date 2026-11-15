# Task 1 review, pass 1

- Reviewer: Noether (fresh subagent, claude-opus-5-5)
- Reviewed: 2283407ad39f45725a667b516fd9925820980932 (Task 1, diff from 306a436)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Important | `browser.schema.json` `$defs.view.from_server.url` (pattern = `x-masked-url`); spec, The address bar ("exactly as sent (masked)") and Connection ("doesn't match its shape is ignored"); `L-TEST-1` | `browser.html` `MASKED` and the `url` branch of `onMessage`; `test/browser-view-page.test.mjs` | The page's `MASKED` equals `x-masked-url` today (checked: `new RegExp(page).source === new RegExp(schema).source`), but no test pins it. Mutation M5, which replaces `MASKED.test(m.url)` with `true` so any URL is shown, passes all 5 tests. Nothing in T2 to T4 adds this test either: spec check 6 and plan T4 list non-JSON, an unknown `t`, `w: 0` and bad `data`, but no unmasked `url`. So the page's own guard on the address bar can drift from the contract or disappear without any test failing. Fix: assert in the file-text test that the `MASKED` literal's source equals the schema's `x-masked-url`. In Chrome, send an unmasked `url` (e.g. `https://a.example/x?token=abc`, or one with a `#frag` or `user:pass@`) after a masked one, and check that `#addr` still shows the masked one. | fixed: MASKED is built from String.raw text a test holds equal to x-masked-url; a test sends unmasked urls (query value, fragment, user:pass, long digits, file:) and one with an extra field, and none is shown |
| T1-2 | Minor | spec, Connection ("then doubling up to 5 s between tries, back to 0.5 s once a socket opens"); plan T1, Write the page | `connect()`; reconnect test | The backoff is correct in the code: 500, 1000, 2000, 4000, 5000, and back to 500 on `open`. But no test covers the doubling or the reset. M6, which drops `wait = 500` on open, passes all tests. The plan's T1 test list only asks for reconnecting within 3 s, so this is not a gap against the plan. A cheap pin: refuse twice, then measure the gap after an open-then-close. | fixed: a test measures the tries after a close (0.5, 1, 2, 4 s) and the reset to 0.5 s once a socket opened |
| T1-3 | Minor | spec, Connection ("The last frame stays on screen, dimmed, while it is down"; "Before the first frame the screen says …") | reconnect test, first test | The `.area.down` dimming and the "Connecting to the supervisor's browser…" text are implemented, but neither is asserted. The reconnect test could check `#area.classList.contains('down')` alongside "Reconnecting…", and the first test could check `#waiting` before the first frame. | fixed: the waiting line before the first frame and the dimmed area while down are asserted |
| T1-4 | Minor | spec, Connection ("'Connecting…' before, and 'Reconnecting…' after a drop") | `close` handler | If the first socket never opens (server not up yet), the chip goes from "Connecting…" to "Reconnecting…" even though nothing dropped. Keeping "Connecting…" until a socket has opened once would match the words more closely. | fixed: the chip says Connecting until a socket has opened once; a test refuses the first tries |
| T1-5 | Minor | plan, The canvas's size (`fit()` on a new size and on `resize` only) | `fit()` | `fit()` reads the area's `top`, which moves when `#note` appears or empties. T2's "That paste is too long to send." and T3's refusal lines will show `#note`, which pushes the canvas's bottom below the fold until the next resize, against the spec's "never below the fold". This is not reachable in T1, but the design is T1's. Call `fit()` wherever `#note` changes, or reserve `#note`'s height. | fixed: note() sets the line under the bar and fits the canvas again; T2 and T3 use it |
| T1-6 | Minor | `L-TEST-6` / test robustness | `open()`, every test's `p.close()` | `p.close()` only closes the CDP socket (`chrome.mjs`: `close: () => ws.close()`), so each test's tab keeps running until the file's `after`. It goes on reconnecting with backoff to its dead server's port. If a later test's server is given that same port (port 0, unlikely but possible), the old tab connects to it and puts an extra entry in `conns`, which breaks `waitConn`/`last()`. In "the canvas fits" test, the first page is also not closed on a failure path. Navigating each page to `about:blank` before `close()` (or `Target.closeTarget`) would stop this. | fixed: shut() leaves each tab on about:blank before closing its DevTools socket; the fit test closes its page in finally |
| T1-7 | Minor | plan, Task 1 tests (`the page has no Done or hand-back control` as its own test) | first test | `noHandBack()` exists and runs, but only inside the frames test rather than as the named test. The plan's coverage is still met, and T3/T4 call it again. Noted for traceability only. | fixed: the no hand-back check is its own test |

Mutations tried (each on a scratch copy of the page, rehashed so the CSP stays valid unless noted, run with a scratch copy of the test pointed at it):

- M1: `connect()` doesn't reset `drawnSeq`. "reconnects" fails (the `seq: 0` frame is never drawn). Caught.
- M2: no scaling up (`Math.min(1, …)`). "fits the window" fails. Caught.
- M3: no height limit in `fit()`. "fits the window" fails (bottom past `innerHeight`). Caught.
- M4: CSP meta removed (not rehashed). "CSP hashes" fails. Caught.
- M5: `MASKED.test(m.url)` replaced by `true`. All pass. Not caught (T1-1).
- M6: backoff not reset on open. All pass. Not caught (T1-2).

Checked without finding a problem:

- `MASKED`, `JPEG` and `QID` equal the schema's patterns.
- Frame checks: a closed object, `w`/`h` 1..8192, an integer `seq` ≥ 0, the data pattern, and a decode failure kept from the last good frame.
- A `seq ≤ drawn` frame is dropped both before and after decode, and a decode that finishes on a stale socket is dropped.
- The held copy matches exactly. `url` is kept pending while `#addr` has focus.
- The socket URL is the one in the plan's Global constraints.
- The head order is charset, then the CSP. There is one `<style>` and one `<script>`, no `style=` or `on*=` attributes, and no `src`/`href`.
- The script is a single IIFE in strict mode with no globals.
- The suite passes 5/5 on Node 22 (about 10 s).
- The fake server's framer handles 7-, 16- and 64-bit lengths, buffering, ping and close. Chrome is closed in `after`.

Verdict: CHANGES 2283407ad39f45725a667b516fd9925820980932
