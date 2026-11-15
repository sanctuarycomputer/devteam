# Final review, pass 1, track b

- Reviewer: final-b (fresh subagent of the supervisor, claude-sonnet)
- Reviewed: 5a344ae918f4c2e13701eb32fe0d4d51328bf917

| Id | Severity | Rule cited | Where | Finding | Disposition |
|---|---|---|---|---|---|
| FB1 | Minor | spec, Input table (AltGr row: "Ctrl and Alt together on Windows") | docs/devteam/dashboard/browser.html, `altGr` | `e.ctrlKey && e.altKey` counts as AltGr on every platform, not only Windows. On Linux or macOS, Ctrl+Alt+<letter> is sent as typed text with no mods instead of as a chord. Rare, and the server only sees a letter. | fixed: Ctrl and Alt together count as AltGr only when the key types something other than its own letter (Ctrl+Alt+Q typing @ is a character, typing q a chord), on every platform; a test sends Ctrl+Alt+q as a chord |
| FB2 | Minor | spec, Edge cases ("page works at phone width", owner may use a phone) | browser.html, `dialog { max-width: var(--text) }` | The page has no horizontal overflow at 360 px (checked in Chrome), but the sign-out dialog overrides the browser's default side margin, so it fills edge to edge (x=0, width 360). The address field is about 130 px wide there. Usable, not tidy. | fixed: the dialog is min(the text width, the window less 32 px) wide, so it keeps a side margin on a phone |
| FB3 | Minor | spec, The screen (the whole remote viewport is always on screen) | browser.html, `fit()` and the `held` handler | The foot line can wrap to two lines on a narrow screen, but `fit()` is not re-run when the foot text changes, so the canvas can overflow the window by a line until the next resize. | fixed: the canvas fits again whenever the held line changes |
| FB4 | Minor | spec, Address bar | browser.html, submit handler | An address typed while the socket is down is dropped (as "nothing is queued" requires) but the page says nothing, so the owner may think it was sent. | fixed per ruling m-20261115-055916125-supervisor: an address or Back with no open socket sends nothing and says Not connected: not sent.; a test covers both and the send once connected |
| FB5 | Minor | quality.md §3 (record) | spec.md | spec.md still says `clicks` is the event's `detail` and that console and errors come from CDP; the two approved changes (page-counted clicks, in-page recorder) live only in plan.md "Changes from the approved spec" with the supervisor's message m-20261115-035923461-supervisor. The code and tests match the plan. | fixed: spec.md's Rulings now lists the rulings made after its approval and points to plan.md |

## What I checked

- Read quality.md §3, spec.md, verification.md, pr-body.md, the contract `$defs.view` in browser.schema.json, and the whole of browser.html. I read the test file only where it bore on a check.
- Ran only `test/browser-view-page.test.mjs` on `/usr/local/bin/node` (Node 22) with the box rule's env: 30 pass, 0 fail, 0 skipped. Chrome is present, so nothing skipped.
- Frames: base64 JPEG decoded via `createImageBitmap` on a Blob, canvas set to `w` and `h`, scaled to fit, lower or equal `seq` dropped, `seq` reset per socket, bad `w`/`h`/`data` skipped, last good frame kept.
- Url and held: url shown exactly as sent, and only if it matches the schema's mask (held equal to the schema by a test); the pending url waits while the field has focus. Held copy is exact: "When you're done, press Done on the card." and "The supervisor has the browser. You can watch."
- Connection: the 0.5 s to 5 s backoff, reset on open. The chip says Connecting…, Live or Reconnecting…, and the last frame is dimmed while down. `bye` is shown with `textContent`, closes its socket, and does not reconnect until Show it again. Non-JSON, unknown `t` and wrong-shape messages are ignored.
- Input: the click versus drag 4 px rule, `down` at the press point, one move per animation frame with a waiting move flushed before `up`, pointer capture and lost capture. Page-counted clicks (500 ms, 4 px, up to 3), wheel scaled by delta mode and clamped. Printable keys as `press`, Enter as `\r`, AltGr, Backspace and the others as `down`/`up`, modifier-only keys sending nothing, Cmd keyup handling. Paste chords left to the `paste` event, chunked at 10 000 on code-point boundaries, refused above 100 000. Every message was compared with the closed `from_page` shapes (`text` at most 8, `key` at most 32, `mods` at most 15). Nothing is queued while down and no storage or console API is used.
- Address bar: SCHEME regex, then `new URL` and a protocol check (http and https only), length at most 2048, with the exact refusal words. `localhost:8080` and `shop.example/account` get https://. Back sends `back`. Sign out opens a dialog, and only the confirm button sends `forget`.
- No Done, hand-back or answer control. The foot text only names the card's Done.
- Meta CSP matches the spec's string, with hashes the test recomputes; Chrome refuses a foreign script and stylesheet (test 6). The page has no external src or href, and `connect-src 'self'`.
- Phone width: rendered at 360x640 mobile in Chrome. No horizontal scroll, and the bar and dialog fit (FB2 and FB3 are cosmetic).
- Scope: the diff outside the ticket folder is only browser.html and the test file, which are the plan's touches. No project-specific names in either (grep of devteam-dev, sanctuary, ticket ids, the feature name: none). The PR body states what the page doesn't defend against (extension or devtools in the owner's browser, other processes as the owner's OS user, the server it sends to).
- Mutation attempt: I tried scratch mutations of the page (AltGr, shift mods, click clamp). Each one broke the page's own CSP hash, so all 30 tests failed for that reason and the runs show nothing about the mutated line. I did not redo them with the hash recomputed. The worktree was restored and is clean.
- I found no Critical or Important issue.

Verdict: APPROVE 5a344ae918f4c2e13701eb32fe0d4d51328bf917
