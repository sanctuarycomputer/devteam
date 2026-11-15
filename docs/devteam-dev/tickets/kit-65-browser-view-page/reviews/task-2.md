# Task 2 review, pass 1

- Reviewer: Lovelace (fresh subagent, claude-opus-5-5)
- Reviewed: 6fedb8f88ef6efa09bfba994926d3da9d84f0d1e (Task 2, diff from 917cfe6)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-1 | Important | `L-TEST-1`; spec, input table, click row ("a press and release of one button within 4 px of the press") | `test/browser-view-page.test.mjs`, the click and drag tests | Nothing tests the 4 px rule. Mutation M1 replaces `Math.hypot(...) > 4` with `true`, so any move during a press turns it into a drag, and every T2 test still passes. `clickAt` sends no move between press and release, and the drag moves about 100 px. Add a press, a `mouseMoved` with `buttons: 1` 2 to 3 px away, then a release: the server must get one `click` at the press point and no `down`. | |
| T2-2 | Important | `L-TEST-1`; spec, drag row ("A move still waiting for its animation frame when the button comes up is sent before the `up`, never after") | the drag test | Nothing tests flush-before-up. Mutation M3 drops `flush()` from `pointerup`, and every test still passes. Headless Chrome dispatches CDP mouse events on the animation frame, so the queued move has always gone out before the release arrives. To make it deterministic, have the test's recorder (it already runs before the page's script) replace `requestAnimationFrame` with a callback the test fires by hand. Then hold the frame, release, and assert the last message is `up` and the held move came before it. | |
| T2-3 | Minor | `L-TEST-1`; spec, drag and move rows ("at most one per animation frame") | the drag test | The throttle isn't tested. M4 sends every move at once and still passes. The held-`requestAnimationFrame` hook from T2-2 covers this too: send several moves within one held frame and assert one `move` goes out, at the newest point. M23 drops `mods` from hover moves and also passes, so assert a Shift hover move carries `mods: 8` while that hook is in place. | |
| T2-4 | Minor | `L-TEST-1`; spec, wheel row (line ×16, page × frame height, ±100 000 clamp) | the wheel test | CDP's `mouseWheel` is always in pixel mode, so neither the scaling nor the clamp is tested. M5 (line ×1) and M6 (no clamp) both pass. A `WheelEvent` dispatched on the canvas with `deltaMode: 1` and `deltaMode: 2`, and one with `deltaY: 1e7`, would pin them: the wheel handler needs no pointer capture, so a synthetic event works there. | |
| T2-5 | Minor | `L-TEST-1`; spec, Input ("a drag released outside the canvas still sends its `up`, clamped to the edge") | the drag tests | No drag is released outside the canvas. M21 removes the clamp in `toFrame` and passes. Releasing a drag past the canvas's right and bottom edges should send an `up` at `x: 320, y: 200`. The `up` could also break the contract's 0 to 8192 range on a frame near 8192 wide. | |
| T2-6 | Minor | spec, paste row ("The paste chord itself sends no `key` message, so the remote page never also pastes its own clipboard") | `browser.html` `pasteChord` | `pasteChord` matches `e.key === 'v' \| 'V'` only. On a non-Latin layout (Russian, Greek), Ctrl+V or Cmd+V gives `key: 'м'` with `code: 'KeyV'`. The page then prevents the default, so no `paste` event fires. It sends `key down 'м' mods 2`, and the remote page pastes its own clipboard: the outcome the spec rules out. Also match `e.code === 'KeyV'` when `e.key` isn't a Latin letter. | |
| T2-7 | Minor | spec, any-other-key row (an `up` on keyup); ruling m-20261115-034535632-supervisor; plan Global constraints ("the held-key Set keeps only non-printable key names") | `browser.html` `held`, keyup | (a) macOS fires no `keyup` for a key pressed while Cmd is held. After Cmd+A or Cmd+C, the remote side gets a `down` with no `up`, and `held` keeps `KeyA` until the socket closes (T4 clears it). Sending `up` for whatever is in `held` when Meta comes up, and on canvas blur, would end those presses. (b) Judged against the ruling: `held` keeps `e.code`, falling back to `e.key` when `code` is empty, for keys sent as `down` only: named keys and Ctrl or Meta chords. It never keeps a character typed as text (a `press`) or any paste, and each entry goes on its key's `up`. That meets the ruling's intent. The plan says "key names" while the code keeps codes, so make the two words agree. | |
| T2-8 | Minor | spec, click row (a click is a release "within 4 px of the press") | `browser.html` `pointerup` | The page only checks the 4 px rule on `pointermove`. A release more than 4 px from the press with no move in between, possible with coalesced or synthetic input, is sent as a `click` at the press point. M25 (the click at the release point) passes, because the test releases where it pressed. Check the distance in `pointerup` as well. Past 4 px, send `down` at the press point, then `up` at the release. | |
| T2-9 | Minor | spec, paste row ("Over that ... the page says") | `browser.html` paste handler, `note` | "That paste is too long to send." is never cleared, so it stays up after a later paste that does go through. T3 also writes `#note`; T3 should clear it on a successful paste or nav. | |

Checked and fine: the click count (500 ms, 4 px, same button, up to 3; caught by M2). The drag's `down` is at the press point (M22). Drag moves carry their button, and every mouse, wheel and key message carries `mods` when a modifier is held (M15, M16). Modifiers alone send nothing (M17). Printable keys send `press` with `text` set to the key and Shift as their only mod (M9). AltGr (M7) and Enter (M8) work. Other keys go as `down`, then `up` only when that `down` was seen (removing the check sends an extra `up` after "ab"). The paste chords are left to the browser (M10). Paste pieces are 10 000 UTF-16 units, cut between code points (M11), with a 100 000 cap (M12). The context menu (M13), key and wheel defaults (M18, M19) and lost capture (M14, M14b) all behave. `toFrame` scales by the newest frame (M24). On the contract: `key`, `code` and `text` lengths are checked in UTF-16 units, which bounds the code-point lengths the schema counts. `clicks` stays within 1 to 3, `x` and `y` within `[0, w]`, and the wheel deltas are clamped. No field is sent that the schema doesn't list. Typed text and pastes live only in the handler: `queued`, `press` and `lastClick` hold mouse data only. The `isComposing` guard is there (M26 passes, as the plan expects: CDP can't start a composition). The T2 tests synchronize on events, not fixed delays, except for `sent()`'s 400 ms settle and the 600 ms gaps past the double-click window. Those are generous, and the file passed every run here.

Mutations tried. Each ran on a scratch copy of the page with its script and style hashes recomputed (sha256 base64 of the exact text in its one `<script>` and one `<style>`), against a scratch copy of the test whose `PAGE` points at that copy, on Node 22 (`nice /usr/local/bin/node --test --test-concurrency=2`). The scratch test also fails "the address bar shows only a masked url", because it reads the schema by a relative path the scratch directory lacks. That happens on M0 too, so it is the harness, not the page, and is left out below. The real file passes 17 of 17.

- M0: no change. Only the harness's own failure.
- M1: 4 px rule removed (any move is a drag). **Not caught** (T2-1).
- M2: the click count always 1. Caught (click test).
- M3: no `flush()` before the drag's `up`. **Not caught** (T2-2).
- M4: moves not throttled. **Not caught** (T2-3).
- M5: wheel line mode ×1. **Not caught** (T2-4).
- M6: wheel deltas not clamped. **Not caught** (T2-4).
- M7: `altGr` always false. Caught (keys test).
- M8: no Enter row. Caught (keys test).
- M9: a printable key gets all its mods. Caught (keys test).
- M10: the paste chord not exempted. Caught (paste test).
- M11: no surrogate guard at the cut. Caught (paste test).
- M12: no 100 000 cap. Caught (paste test).
- M13: context menu not prevented. Caught (defaults test).
- M14: a lost capture sends nothing. Caught (lost-capture test).
- M14b: a lost capture sends an `up` for a press not yet a drag. Caught (lost-capture test).
- M15: no `mods` on the click. Caught (click test).
- M16: no `mods` on drag moves. Caught (drag test).
- M17: modifiers alone are sent. Caught (click, drag, keys, paste tests).
- M18: keydown not default-prevented. Caught (defaults test).
- M19: wheel not default-prevented. Caught (wheel test).
- M20: no `setPointerCapture`. Caught (click test).
- M21: `toFrame` not clamped. **Not caught** (T2-5).
- M22: `down` at the move point, not the press point. Caught (drag test).
- M24: no scaling to the frame. Caught (six tests).
- M25: the click at the release point. **Not caught** (T2-8).
- M23: no `mods` on hover moves. **Not caught** (T2-3).
- M26: no `isComposing` guard. Not caught (expected: the plan leaves it to review).

Verdict: CHANGES 6fedb8f88ef6efa09bfba994926d3da9d84f0d1e
