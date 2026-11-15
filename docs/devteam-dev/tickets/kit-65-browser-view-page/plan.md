# kit-65-browser-view-page: plan

## TL;DR

- Two files, both in `touches`: the page `docs/devteam/dashboard/browser.html` (inline style and script, its own meta CSP with sha-256 hashes) and `test/browser-view-page.test.mjs`.
- The test drives real headless Chrome (`test/lib/chrome.mjs`) against a fake server written in the test: Node `http` serves the page at `/` and a minimal RFC 6455 socket at `/socket`, which replays fixture messages and records what the page sends.
- Four tasks, each test-first: T1 the screen (frames, url, held, CSP, no hand-back, not skipped on CI); T2 the owner's input (mouse, wheel, keys, paste, nothing queued or leaked); T3 the address bar, Back and Sign out of everything; T4 the connection (reconnect, `bye`, bad messages, `seq` order).
- Every message the page sends is checked against `browser.schema.json` `$defs.view.from_page.<t>` with `test/fixtures/browser/check.mjs`'s validator, so a stray field fails.
- Local runs use Node 22 (`/usr/local/bin/node`; the box's default `node` is 18, where the test skips), this file only, `--test-concurrency=2`. CI is the gate.
- A task review record per task (`reviews/task-<n>.md`, fresh subagent); two final reviews from other sessions (risk high).
- No contract change, no one-way door.

> For the implementer: run it with superpowers:executing-plans, task by task, test first.

**Goal:** the live browser view page, as the spec says, tested in Chrome.
**Spec:** `docs/devteam-dev/tickets/kit-65-browser-view-page/spec.md` (read it with this plan; its "What the page does" is the behaviour, its acceptance checks are the tests).
**Tech:** plain HTML, CSS and browser JavaScript (no library); the test is `node:test` with built-ins only.

## Global constraints

- Only `docs/devteam/dashboard/browser.html` and `test/browser-view-page.test.mjs` change (plus this ticket's records).
- The page loads nothing: no `src`/`href` to anything but itself; one `<style>`, one `<script>`, no `style=` attributes, no inline event handlers (the CSP would refuse them).
- Meta CSP exactly: `default-src 'none'; script-src 'sha256-<b64>'; style-src 'sha256-<b64>'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'`.
- The socket: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/socket`.
- Copy, exactly: "When you're done, press Done on the card." (held a qid); "The supervisor has the browser. You can watch." (held null); "Connecting to the supervisor's browser…"; "Only http and https addresses open here."; "That address is too long."; "That paste is too long to send."; "You can close this page."; buttons "Back" (shown as ←, `aria-label="Back"`), "Sign out of everything", "Sign out of every site", "Cancel", "Show it again"; chip "Live" / "Connecting…" / "Reconnecting…"; the dialog text "Sign this project's browser out of every site? Every site it is signed into forgets it, and the browser starts again empty."
- Nothing typed or pasted goes to `console`, any storage API, or the DOM; no input is buffered while the socket is down.
- Running text: `max-width` half the page's max width (the owner's 6-of-12 columns rule); light and dark via `prefers-color-scheme`.
- No word "Done" on any control.

## Review focus

1. A key held while the socket drops and comes back (the keyup never sent before): the page must not send an `up` for a `down` the new socket never saw. Test in T4: press-and-hold Backspace, close the socket, reopen, release: the new socket gets no `up`.
2. A frame drawn, then a different-sized frame: coordinates use the newest frame's `w`/`h`, not the first. Test in T2: click after the 160×100 frame and after the 320×200 one.
3. The address bar focused while a `url` arrives: what the owner is typing isn't clobbered. Test in T3.
4. `why` or `url` carrying markup (`<img src=x onerror=…>`): shown as text, nothing runs and nothing loads. Test in T4 (the `why`) and T3 (the `url`).
5. Paste of a string with an emoji right at the 10 000-character cut: two pieces, neither with a lone surrogate. Test in T2.

---

## The test file's shape (built in T1, extended by each task)

`test/browser-view-page.test.mjs`:

- Imports `canDrive`, `openChrome` from `./lib/chrome.mjs`; `message` from `./fixtures/browser/check.mjs` (`message('from_page', m)` returns an array of errors, empty when valid).
- Guard: `const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;` If `mustRun && !canDrive`, a test that fails with "Chrome is needed on CI's Node 22+". Otherwise every test has `skip: canDrive ? false : 'needs Chrome and a Node with WebSocket'`.
- `startServer()` → `{ port, url, conns, waitConn(n), close() }`: `http.createServer` serving `browser.html` (read fresh from disk) at `/` with `content-type: text/html; charset=utf-8`; `upgrade` on `/socket` does the handshake (`258EAFA5-…` accept), keeps each connection as `{ sent: [], send(obj|string), close(), closed }`, decodes masked client text frames (lengths 7-bit, 16-bit and 64-bit; buffered across `data` events; answers ping, honours close), and pushes each parsed JSON message onto `conn.got`.
- One Chrome for the file (`before`/`after`), a fresh page per test (`chrome.newPage()`), `Page.enable`. `newPage` exposes no CDP events and `chrome.mjs` isn't in touches, so console and exception capture is in the page's world: before navigating, `Page.addScriptToEvaluateOnNewDocument` installs a recorder that wraps every `console` method and listens to `error` and `unhandledrejection` into `window.__seen` (strings); the tests read it with `ev`. The recorder is the test's, never in `browser.html`.
- `until(fn, what, ms = 3000)` polling helper; `valid(msg)` asserts `msg.t` has a `from_page` shape and validates against it.

## Task 1: the screen

**Files:** create `docs/devteam/dashboard/browser.html`, `test/browser-view-page.test.mjs`.

**Produces:** in the page, `connect()`, `onMessage(obj)`, a `<canvas id="screen" tabindex="0">`, `#addr` (input), `#back`, `#signout`, `#foot` (the held line), `#chip`, `#bye` (panel with `#bye-why` and `#again`), `#note` (the line under the bar). Module-level `frame = { w, h, seq }` (the last drawn) and `socket`.

- [ ] Write tests (they fail: no page):
  - `the page draws each frame at its size, shows the url, and the held line`: replay `view-from-server.json` minus `bye`, one message at a time; after each frame `canvas.width/height` equal its `w/h` and `getImageData` has a non-zero alpha pixel; `#addr.value === 'https://shop.example/account/login?next=•••'` after the first url; `#foot` text equals "When you're done, press Done on the card." after the qid `held`, and "The supervisor has the browser. You can watch." after `held: null`.
  - `the page's CSP hashes its own script and style, and it loads nothing from elsewhere`: from the file text, the meta CSP equals the constant above with `sha256` of the exact text between `<script>` and `</script>` and between `<style>` and `</style>`; no `src=`/`href=` attribute in the file; in Chrome, inject `<script src=http://127.0.0.1:<other>/x.js>` and `<link rel=stylesheet href=http://127.0.0.1:<other>/x.css>`: a `securitypolicyviolation` event fires for each and the other server's request count stays 0.
  - `the page has no Done or hand-back control`: no `button, a, input, [role=button]` whose text, `aria-label`, `title` or `value` matches `/\bdone\b|hand.?back|give.?back/i`. Call this helper again at the end of T3's and T4's tests (states: held, dialog open, bye).
  - the CI guard test above.
- [ ] Run `/usr/local/bin/node --test --test-concurrency=2 test/browser-view-page.test.mjs`: fails.
- [ ] Write the page: layout after the mock's step 2 (bar, screen, foot), its colours; the socket per Global constraints; `frame` handling per spec (createImageBitmap on a Blob from base64, drop `seq` lower than the last drawn on this socket, skip bad ones; set `width`/`height` then draw); `url` → `#addr` unless focused (pending, applied on blur); `held` → `#foot`. Compute the two hashes with a one-off `node -e` and paste them into the meta.
- [ ] Run: passes. Commit `kit-65: T1 the screen`. Review record `reviews/task-1.md`.

## Task 2: the owner's input

**Files:** modify both.

**Consumes:** T1's `frame`, `socket`, `#screen`.
**Produces:** `send(obj)` (drops when `socket?.readyState !== 1`; the only path out), `toFrame(ev) → {x, y}`, `mods(ev) → 0..15`.

- [ ] Write tests, with a 320×200 frame drawn and the canvas forced to 640×400 CSS px by the window size (`Emulation.setDeviceMetricsOverride` width 700, height 700), per spec check 2: click (one `click`, `x,y` = CSS point/2 within 1), Shift+click (`mods: 8`, no `key`), drag (`down`, ≥1 `move` `button:"left"`, `up`), wheel (one `wheel`, `dy: 120`), "ab" (two presses), Enter (`text:"\r"`), real paste (grant, focus emulation, `writeText`, Ctrl+V with `commands:['paste']`: one `paste`, no `key`), the emoji-at-cut paste (Review focus 5), and the 160×100 frame coordinates (Review focus 2). Count every message except `mouse move` sent before a press. Each is `valid`.
  - `what the owner types goes nowhere else` (spec check 5): server closes the socket; type `marker-typed-7Q` and paste `marker-pasted-7Q` into the canvas; let it reconnect; no conn's `got` contains either. Then connected, type and paste both: nothing in `window.__seen` carries them, `localStorage.length + sessionStorage.length === 0`, `indexedDB.databases()` empty, and `document.documentElement.outerHTML` plus every `input.value` don't contain them.
- [ ] Run: fails.
- [ ] Implement per the spec's input table: pointer events on the canvas with `setPointerCapture`; the 4 px click rule (press held back until release or travel); `move` throttled with `requestAnimationFrame` and flushed before `up`; `lostpointercapture` sends `up` for a sent `down`; `wheel` listener `{ passive: false }` with deltaMode scaling and the ±100 000 clamp; keydown/keyup on the canvas with the printable/AltGr/Enter/other/modifier rows; `paste` on the canvas (chords Ctrl+V, Cmd+V, Shift+Insert skip the key path) with code-point pieces and the 100 000 cap (`#note` text); `contextmenu` prevented.
- [ ] Run: passes. Commit `kit-65: T2 the owner's input`. `reviews/task-2.md`.

## Task 3: the address bar, Back, Sign out of everything

**Files:** modify both.
**Consumes:** T2's `send`.
**Produces:** `toNav(typed) → { url } | { refuse: string }`.

- [ ] Write tests per spec check 3 and check 2's nav, back, forget lines: refusals (`javascript:alert(1)`, `file:///etc/passwd`, `data:text/html,x`, `about:blank`, `chrome://settings`) send nothing and set `#note` to "Only http and https addresses open here."; a 2049-character URL → "That address is too long."; `shop.example/account` → `nav` `https://shop.example/account`; `localhost:8080/x` → `https://localhost:8080/x`; `http://a.example/` as typed; Back → one `back`; Sign out → dialog open, nothing sent; Cancel → nothing; Escape → nothing; confirm → one `forget`. A `url` arriving while `#addr` is focused and edited leaves the edit, and shows on blur (Review focus 3). A `url` of `https://a.example/<i>hi<i>` (it passes the mask pattern; a markup query value would not) is shown as that text, not markup (Review focus 4: `#addr.value` equals it, no `i` element in the page).
- [ ] Run: fails. Implement: a `<form>` around `#addr` with submit handling (`preventDefault`, `form-action 'none'` blocks a real submit anyway); `toNav` per spec (`://` → parse; `/^[a-z][a-z0-9+.-]*:(?!\d)/i` → parse; else prefix `https://`; protocol must be `http:`/`https:`, length ≤ 2048); a `<dialog id="confirm">` with `showModal()`.
- [ ] Run: passes. Commit `kit-65: T3 the address bar, Back and Sign out`. `reviews/task-3.md`.

## Task 4: the connection

**Files:** modify both.

- [ ] Write tests per spec check 4 (reconnect within 3 s and frames draw on the new socket; `bye` shows `why`, the page closes its socket, no new socket within 3 s, Show it again opens one) and check 6 (non-JSON, unknown `t`, `frame` with `w: 0`, a frame with bad `data`: no error in `window.__seen`, size stays, next good frame draws; `seq` 5 at 320×200 then `seq` 4 at 160×100 stays 320×200; the chip reads Live / Reconnecting…), Review focus 1 (held Backspace across a reconnect: no `up` on the new socket), Review focus 4 (`why` with markup shown as text).
- [ ] Run: fails. Implement: reconnect timer 500 ms doubling to 5000, reset on open; dim the canvas while down (a class); `bye` sets a flag, shows the panel, closes the socket, no timer; Show it again clears the flag and connects; keys `down` sent per socket tracked in a Set cleared on close; message validation by `t` with type and range checks per the contract.
- [ ] Run: passes. Commit `kit-65: T4 the connection`. `reviews/task-4.md`.

## Then

Verification (`verification.md`, a row per done-when at a named commit), merge `origin/main`, push, PR, `check-ticket`, two final reviews from other sessions (`review-request` to the supervisor), merge request.

## Spec review 2's Minor points, settled here

- **M1 (`bye` wording):** read as Provided item 6 and check 4 say it: on `bye` the page closes its socket at once; Show it again only opens a new one.
- **M2 (small frames):** the canvas scales **up** as well as down: CSS `width: 100%` of the screen area, `height: auto`, with `max-height` the viewport less the bars (then `width: auto`), aspect kept. T2's test sets the window to 700×700 (`Emulation.setDeviceMetricsOverride`) and asserts the canvas's on-screen width isn't 320 before it clicks, so a page that never scales its coordinates fails.
- **M3 (the down-socket race):** in check 5's first step the fake server refuses upgrades (answers 503) until the test has typed and pasted, and the test waits for the chip to read "Reconnecting…" before typing; then it lets upgrades through.
- **M4 (modifiers on drags):** every `mouse` message (`down`, `move`, `up`, `click`) and every `wheel` carries `mods` when any is held. T2 adds a Shift+drag test: `down`, `move`, `up` each with `mods: 8`.

## Rulings

None yet.
