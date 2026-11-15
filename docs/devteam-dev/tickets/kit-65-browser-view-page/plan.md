# kit-65-browser-view-page: plan

## TL;DR

- Two files, both in `touches`: the page `docs/devteam/dashboard/browser.html` (inline style and script, its own meta CSP with sha-256 hashes) and `test/browser-view-page.test.mjs`.
- The test drives real headless Chrome (`test/lib/chrome.mjs`) against a fake server written in the test: Node `http` serves the page at `/` and a minimal RFC 6455 socket at `/socket`, which replays fixture messages and records what the page sends.
- Four tasks, each test-first: T1 the screen and the connection's basics (frames, url, held, CSP, no hand-back, reconnect with its chip, not skipped on CI); T2 the owner's input (mouse, wheel, keys, paste); T3 the address bar, Back and Sign out of everything; T4 the connection's edges (`bye`, bad messages, `seq`, input never queued or leaked, nothing reachable from another origin).
- Every message the page sends is checked against `browser.schema.json` `$defs.view.from_page.<t>` with `check.mjs`'s `message`, so a stray field fails.
- Local runs use Node 22 (`/usr/local/bin/node`; the box's default `node` is 18, where the test skips), this file only, `--test-concurrency=2`. CI is the gate.
- A task review record per task (`reviews/task-<n>.md`, fresh subagent); two final reviews from other sessions (risk high).
- No contract change, no one-way door. Ruling m-20261115-034535632-supervisor (below) is in T4's tests, memory included (a closure walk, with a mutation that must fail it); two small changes from the spec are listed for the supervisor's word.

> For the implementer: run it with superpowers:executing-plans, task by task, test first.

**Goal:** the live browser view page, as the spec says, tested in Chrome.
**Spec:** `docs/devteam-dev/tickets/kit-65-browser-view-page/spec.md` (approved at 31f2170; read it with this plan: its "What the page does" is the behaviour, its acceptance checks are the tests).
**Tech:** plain HTML, CSS and browser JavaScript (no library); the test is `node:test` with built-ins only.

## Global constraints

- Only `docs/devteam/dashboard/browser.html` and `test/browser-view-page.test.mjs` change (plus this ticket's records).
- The page loads nothing: no `src`/`href` to anything but itself; one `<style>`, one `<script>`, no `style=` attributes, no inline event handlers (the CSP would refuse them).
- `<head>` opens with `<meta charset="utf-8">` then the CSP meta, before anything else (a meta CSP applies only to what follows it). The CSP, exactly: `default-src 'none'; script-src 'sha256-<b64>'; style-src 'sha256-<b64>'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'`.
- The script is one IIFE in strict mode: it defines no global, adds no `message` listener, never calls `postMessage`, and never writes `window.name`, `document.cookie`, `history` state or the URL.
- The socket: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/socket`.
- Copy, exactly: "When you're done, press Done on the card." (held a qid); "The supervisor has the browser. You can watch." (held null); "Connecting to the supervisor's browser…"; "Only http and https addresses open here."; "That address is too long."; "That paste is too long to send."; "You can close this page."; buttons "Back" (shown as ←, `aria-label="Back"`), "Sign out of everything", "Sign out of every site", "Cancel", "Show it again"; chip "Live" / "Connecting…" / "Reconnecting…"; the dialog text "Sign this project's browser out of every site? Every site it is signed into forgets it, and the browser starts again empty."
- What the owner types or pastes lives only in the event handler that sends it: no variable, array, Set or closure keeps a typed character, a pasted text or a piece of one after `send` returns (the held-key Set keeps only non-printable key names, Backspace and the like, and is emptied on close). It goes to no `console`, no storage API, no DOM node; no input is buffered while the socket is down.
- Running text: `max-width` half the page's max width (the owner's 6-of-12 columns rule); light and dark via `prefers-color-scheme`.
- No word "Done" on any control.

## The canvas's size (spec M2; plan review P4)

Sized from the script, not CSS alone: on every frame whose `w`×`h` differs from the last, and on `resize`, `fit()` sets `canvas.style.width` and `.height` (CSSOM, which the CSP allows) to `w × s` and `h × s` px, with `s = min(areaWidth / w, (innerHeight − barsHeight) / h)`: the largest that fits both, up or down, aspect kept. No `object-fit`, so the drawn image fills the canvas's box exactly and `toFrame` is just `(clientX − rect.left) × w / rect.width`. Tests compute what they expect from the canvas's own `getBoundingClientRect()`, never from an assumed size.

## Review focus

1. A key or a mouse button held while the socket drops and comes back: the page sends no `up` for a `down` the new socket never saw. Test in T4.
2. A frame drawn, then a different-sized frame: coordinates use the newest frame's `w`/`h`. Test in T2.
3. The address bar focused while a `url` arrives: what the owner is typing isn't clobbered. Test in T3.
4. `why` or `url` carrying markup: shown as text. Test in T4 (`why`) and T3 (`url`).
5. A paste with an emoji right at the 10 000-character cut: two pieces, neither with a lone surrogate. Test in T2.

---

## The test file's shape (built in T1, extended by each task)

`test/browser-view-page.test.mjs`:

- Imports `canDrive`, `openChrome` from `./lib/chrome.mjs`; `message` from `./fixtures/browser/check.mjs` (`message('from_page', m)` returns an array of errors, empty when valid).
- Guard: `const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;` If `mustRun && !canDrive`, a test that fails with "Chrome is needed on CI's Node 22+". Otherwise every test has `skip: canDrive ? false : 'needs Chrome and a Node with WebSocket'`.
- `startServer()` → `{ port, conns, refuse(bool), waitConn(n, ms), close() }`: `http.createServer` serves `browser.html` (read fresh from disk) at `/` with `content-type: text/html; charset=utf-8`, and counts other requests. `upgrade` on `/socket`: while `refuse(true)` is set it answers `HTTP/1.1 503` and destroys the socket; otherwise it does the handshake (`258EAFA5-…` accept). Each connection is `{ got: [], send(obj | string), close(), open }`: `got` is what the page sent (parsed JSON), `send` writes a text frame to the page. The framer decodes masked client frames with 7-, 16- and 64-bit lengths, buffered across `data` events, answers ping, honours close.
- One Chrome for the file (`before`/`after`), a fresh page per test (`chrome.newPage()`), `Page.enable`. `newPage` exposes no CDP events and `chrome.mjs` isn't in touches, so console and error capture is in the page's world (a change from the spec's "CDP `Runtime.consoleAPICalled`", named in the review request): before navigating, `Page.addScriptToEvaluateOnNewDocument` installs a recorder that wraps every `console` method, turning each argument into full text (`String`, then `JSON.stringify`, then an Error's `stack`) into `window.__seen`, and listens on `window` (bubble phase, so after the page) to `error`, `unhandledrejection`, and to `keydown`, `wheel` and `contextmenu`, recording each one's `defaultPrevented`. The recorder is the test's, never in `browser.html`. The page script runs as a classic script, so `console` is wrapped before it.
- `until(fn, what, ms = 3000)` polling helper; `valid(m)` asserts `message('from_page', m)` is empty; `drawn(w, h)` waits until the canvas is `w`×`h` with a non-zero alpha pixel; `ready()` waits for the chip "Live", a drawn frame, and `document.activeElement` the canvas (after a click on it) before any input is sent.

## Task 1: the screen and the connection's basics

**Files:** create `docs/devteam/dashboard/browser.html`, `test/browser-view-page.test.mjs`.

**Produces:** in the page, `connect()`, `onMessage(obj)`, `fit()`, a `<canvas id="screen" tabindex="0">`, `#addr` (input in a `<form id="go">`), `#back`, `#signout`, `#foot` (the held line), `#chip`, `#bye` (panel with `#bye-why` and `#again`), `#note` (the line under the bar). Script-local `frame = { w, h, seq }` (the last drawn; `seq` reset to −1 on every new socket) and `socket`.

- [ ] Write tests (they fail: no page):
  - `the page draws each frame at its size, shows the url, and the held line`: replay `view-from-server.json` minus `bye`, one message at a time; after each frame `drawn(w, h)` (160×100, then 320×200); `#addr.value === 'https://shop.example/account/login?next=•••'` after the first url; `#foot` text "When you're done, press Done on the card." after the qid `held`, and "The supervisor has the browser. You can watch." after `held: null`.
  - `the canvas fits the window, up and down`: window 700×700 (`Emulation.setDeviceMetricsOverride`): a 320×200 frame shows wider than 320 px (scaled up); window 1200×500: it fits inside `innerHeight` below the bars, aspect within 1%.
  - `the page's CSP hashes its own script and style, and it loads nothing from elsewhere`: from the file text, the first two elements of `<head>` are the charset and the CSP meta; the CSP equals the constant above with `sha256` (base64) of the exact text between `<script>` and `</script>` and between `<style>` and `</style>`; no `src=`/`href=` attribute in the file. In Chrome, inject `<script src=http://127.0.0.1:<other>/x.js>` and `<link rel=stylesheet href=http://127.0.0.1:<other>/x.css>`: a `securitypolicyviolation` event fires for each and the other server's request count stays 0.
  - `the page has no Done or hand-back control`: a helper `noHandBack()` that finds no `button, a, input, [role=button]` whose text, `aria-label`, `title` or `value` matches `/\bdone\b|hand.?back|give.?back/i`. T3 and T4 call it again (dialog open, `bye` shown).
  - `the page reconnects by itself`: on the first connection a frame `seq: 5` at 320×200 is drawn (`drawn(320, 200)`); the server closes the socket (no `bye`): the chip reads "Reconnecting…", a second connection opens within 3 s, the chip reads "Live", and a frame `seq: 0` at 160×100 sent on it draws (`drawn(160, 100)`: the count restarted; a page that kept 5 would drop it; plan reviews P2, P2-2).
  - the CI guard test above.
- [ ] Run `/usr/local/bin/node --test --test-concurrency=2 test/browser-view-page.test.mjs`: fails.
- [ ] Write the page: layout after the mock's step 2 (bar, screen, foot), its colours; the socket per Global constraints, reconnecting on a close after 500 ms doubling to 5000, reset on open, the chip and a dimmed canvas while down; `frame` per spec (base64 → Blob → `createImageBitmap`, drop `seq` ≤ the last drawn on this socket, skip bad ones; set `width`/`height`, `fit()`, draw); `url` → `#addr` unless focused (kept pending, applied on blur); `held` → `#foot`. Compute the two hashes with a one-off `node -e` and paste them into the meta.
- [ ] Run: passes. Commit `kit-65: T1 the screen`. Review record `reviews/task-1.md`.

## Task 2: the owner's input

**Files:** modify both.

**Consumes:** T1's `frame`, `socket`, `#screen`.
**Produces:** `send(obj)` (drops when `socket?.readyState !== 1`; the only path out), `toFrame(ev) → {x, y}`, `mods(ev) → 0..15`, script-local `press` (the button held, its point, whether a `down` was sent) and `held` (a Set of non-printable key names sent as `down` on this socket).

Every test starts with `ready()` and computes expected `x, y` from the canvas's rect (within 1 px). Counted: every message after the action's first `mousePressed` / `keyDown`, plus `wheel`; `move`s from the helper's pointer travel before a press are left out.

- [ ] Write tests:
  - click (`clickAt`): one `click`, `button: "left"`, `clicks: 1`; two `clickAt`s at one point within 300 ms: the second is `clicks: 2` (the page counts clicks itself, plan review P9: within 500 ms and 4 px of the last, up to 3; `detail` is not read);
  - Shift+click: `hold('Shift', true)` on the focused canvas, `clickAt(x, y, 8)`, `hold('Shift', false)`: one `click` with `mods: 8` and **no** `key` message (plan review P3);
  - drag: `mousePressed`, then `Input.dispatchMouseEvent` `mouseMoved` with `buttons: 1` 40 px on, then `mouseReleased`: `down`, ≥ 1 `move` with `button: "left"`, `up`, in order; Shift+drag (Shift held as a real key): each with `mods: 8`;
  - wheel (`Input.dispatchMouseEvent` `mouseWheel`, `deltaY: 120`): one `wheel`, `dy: 120`;
  - typed "ab" (`type`): two `key press`es, `text` "a", "b"; Enter: one `press`, `text: "\r"`; AltGr: `@` with `modifiers: 3` (Ctrl+Alt): one `press`, `text: "@"`; Backspace: one `down`, one `up`; Ctrl+A: `down` `a` with `mods: 2`, `up`;
  - a real paste (grant `clipboardReadWrite` and `clipboardSanitizedWrite`, `Emulation.setFocusEmulationEnabled`, `navigator.clipboard.writeText`, Ctrl held, `rawKeyDown` `v` `modifiers: 2` `commands: ['paste']`): one `paste` with that text and no `key`; 10 001 characters with an emoji over the cut: two pieces, joined equal to the text, neither ending in a lone high surrogate; 100 001 characters: nothing sent, `#note` "That paste is too long to send."; an empty clipboard: nothing;
  - coordinates after the 160×100 frame, then after the 320×200 one: each scaled by its own frame;
  - Space, ArrowDown and Tab on the canvas, and a right click: each `defaultPrevented` in the recorder; Ctrl+V is not (its `paste` must fire);
  - a lost capture: after a `down` sent (press, travel), the test dispatches `lostpointercapture` on the canvas: one `up` at the last point; a press still waiting to be a click, then a lost capture: nothing.
  - IME composition is not tested (CDP can't start one on a non-editable canvas); the `isComposing` guard is held to the spec by the task review.
- [ ] Run: fails.
- [ ] Implement per the spec's input table: pointer events on the canvas with `setPointerCapture`; the 4 px click rule (the press held back until release or travel), the button from `press`, not from the event; `move` throttled with `requestAnimationFrame` and flushed before `up`; `lostpointercapture` sends `up` for a sent `down`; `wheel` `{ passive: false }` with deltaMode scaling and the ±100 000 clamp; keydown/keyup on the canvas with the printable / AltGr / Enter / other / modifier-alone rows, `mods` on every mouse, wheel and key message; `paste` on the canvas (Ctrl+V, Cmd+V, Shift+Insert skip the key path) in code-point pieces with the 100 000 cap; `contextmenu` prevented.
- [ ] Run: passes. Commit `kit-65: T2 the owner's input`. `reviews/task-2.md`.

## Task 3: the address bar, Back, Sign out of everything

**Files:** modify both.
**Consumes:** T2's `send`.
**Produces:** `toNav(typed) → { url } | { refuse: string }`.

- [ ] Write tests per spec check 3 and check 2's nav, back, forget lines: refusals (`javascript:alert(1)`, `file:///etc/passwd`, `data:text/html,x`, `about:blank`, `chrome://settings`) send nothing and set `#note` to "Only http and https addresses open here."; a 2049-character URL → "That address is too long."; `shop.example/account` → one `nav` `https://shop.example/account`; `localhost:8080/x` → `https://localhost:8080/x`; `http://a.example/` as typed; Back → one `back`; Sign out → the dialog open, nothing sent, `noHandBack()`; Cancel → nothing; Escape → nothing; confirm → one `forget`. A `url` arriving while `#addr` is focused and edited leaves the edit, and shows on blur (Review focus 3). A `url` of `https://a.example/<i>hi<i>` (it passes the mask pattern) shows as that text (`#addr.value` equals it, no `i` element in the page).
- [ ] Run: fails. Implement: `#go`'s submit handler (`preventDefault`; `form-action 'none'` blocks a real submit anyway); `toNav` per spec (`://` → parse; `/^[a-z][a-z0-9+.-]*:(?!\d)/i` → parse; else prefix `https://`; protocol `http:`/`https:`; length ≤ 2048); a `<dialog id="confirm">` with `showModal()`.
- [ ] Run: passes. Commit `kit-65: T3 the address bar, Back and Sign out`. `reviews/task-3.md`.

## Task 4: the connection's edges, and what typing may never reach

**Files:** modify both.

- [ ] Write tests:
  - `bye`: shows `why` in `#bye-why`; the page closes its socket (the server sees the close); no new connection within 3 s; `noHandBack()`; Show it again → a new connection. A `why` of `<b>x</b>` shows as that text, no `b` element.
  - bad messages (spec check 6): non-JSON, an unknown `t`, `frame` with `w: 0`, a frame with bad `data`: nothing in `__seen`, the size stays, the next good frame draws. `seq` 5 at 320×200, wait for `drawn(320, 200)`, then `seq` 4 at 160×100: after 500 ms still 320×200 (plan review P7).
  - held across a reconnect (Review focus 1): Backspace `rawKeyDown` sent (`down` received), the server closes, wait for the second connection, `keyUp`: the second connection gets no `up`; the same for a mouse `down` (press, travel) then the release.
  - `what the owner types goes nowhere else` (spec check 5, plan review P1 and P5): after `ready()`, `refuse(true)`, the server closes; wait for "Reconnecting…"; type `marker-typed-7Q` and paste `marker-pasted-7Q` on the canvas; `refuse(false)`; `waitConn(2, 8000)`, then 1 s settle: no connection's `got` carries either. Then, connected, type and paste both: nothing in `__seen` carries them, `localStorage.length + sessionStorage.length === 0`, `indexedDB.databases()` empty, `document.cookie` empty, `window.name` empty, and neither `document.documentElement.outerHTML` nor any `input.value` contains them.
  - `nothing typed is kept in page memory after it is sent` (ruling m-20261115-034535632-supervisor; plan reviews P2-1, P3-1 to P3-3): a fresh page, `ready()`; type `kЖ` (the test's typed marker: `Ж` is held nowhere in the page's own text) and paste `pasted-Щ` (`Щ` likewise); wait until the server's `got` holds both (sent, so the page is done with them). Then:
    - `Runtime.globalLexicalScopeNames` is empty (no top-level `let`/`const`/`class`);
    - the walk: `DOM.getDocument` `depth: -1`; for `window`, `document` and every element, `DOM.resolveNode` with `objectGroup: 'walk'` (without one, `getEventListeners` returns no `handler`), then `DOMDebugger.getEventListeners`; for each listener's `handler`, `Runtime.getProperties` with `ownProperties: true` gives `[[Scopes]]` in its `internalProperties`; each scope object's properties are read, and every object, array, Set and Map value (a Set's or Map's `[[Entries]]` from `internalProperties`) is walked to depth 4, skipping DOM nodes and `window`, every `Runtime.getProperties` with `ownProperties: true`;
    - no string walked contains `Ж` or `Щ`, and no collection's string members joined (in order, with no separator) contain them: so a page that keeps the last key (`last = e.key`), every key in a Set, or the pasted text fails;
    - the mutation: a scratch copy of the page with `let last = '';` in the IIFE and `last = e.key;` in its keydown handler must make this test fail; the task reviewer runs it once and records it in `reviews/task-4.md`. The walk then releases `objectGroup: 'walk'`.
  - `nothing on the page is reachable from another origin` (ruling m-20261115-034535632-supervisor): `Object.keys(window)` on the page minus those on a blank page of the same origin (which gets the recorder too) is empty (no global from the page's script); CDP `DOMDebugger.getEventListeners` on `window` (its `objectId` from `Runtime.evaluate('window')`) lists no `message` listener; the file text contains no `postMessage`, `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie` or `window.name`; and a second `http` server on another loopback port (a second origin) serves a page with `<iframe src="http://127.0.0.1:<port>/">`; the test navigates to it, waits for the frame's socket to connect, and `ev` in the top page of `frames[0].document` throws `SecurityError` (the browser's own rule, pinned so a later `document.domain` or `postMessage` bridge fails it).
- [ ] Run: fails. Implement: `bye` sets a flag, shows the panel, closes the socket, no timer; Show it again clears it and connects; on every close `press` and `held` are cleared; message checks by `t` with type and range checks per the contract.
- [ ] Run: passes. Commit `kit-65: T4 the connection's edges`. `reviews/task-4.md`.

## Then

Verification (`verification.md`, a row per done-when at a named commit), merge `origin/main`, push, PR (with the `## One-way doors` section `None.`, and a "Doesn't defend against" line per the ruling below), `check-ticket`, two final reviews from other sessions (`review-request` to the supervisor), merge request.

## Spec review 2's Minor points, settled here

- **M1 (`bye` wording):** read as Provided item 6 and check 4 say it: on `bye` the page closes its socket at once; Show it again only opens a new one.
- **M2 (small frames):** the canvas scales up as well as down (The canvas's size, above); T1 tests both, T2 computes from the rect.
- **M3 (the down-socket race):** the fake server refuses upgrades until the typing is done, and the test waits for "Reconnecting…" first (T4).
- **M4 (modifiers on drags):** every `mouse` and `wheel` message carries `mods` when any is held; T2 tests Shift+drag.

## Changes from the approved spec, for the supervisor's word (plan reviews P10, P2-3)

- **Click count.** The spec says `clicks` is the event's `detail`; pointer events can give `detail` 0, so the page counts clicks itself (within 500 ms and 4 px of the last, up to 3). Same result for the owner; T2 tests a double click.
- **Console and errors.** The spec's check 5 and 6 name CDP `Runtime.consoleAPICalled` / `Runtime.exceptionThrown`; `chrome.mjs` exposes no event stream and isn't in touches, so a recorder in the page's world (installed by the test before the page's script) catches the same calls and errors.

## Rulings

- **m-20261115-034535632-supervisor** (on approve-spec): "This is the page the owner types logins into: make sure nothing typed is logged, kept in page memory beyond sending it, or reachable by another origin, and say so in the PR's 'doesn't defend against' line." In this plan: Global constraints (the IIFE, nothing kept after `send`, no storage, no `message` listener or `postMessage`), T4's two last tests, and the PR body. The PR's line names what the page can't defend against: a browser extension or devtools in the owner's own browser, anything running as the owner's OS user, and the server it sends to (kit-66's daemon runs as the agent; the page trusts it to forward and drop, never to store).
