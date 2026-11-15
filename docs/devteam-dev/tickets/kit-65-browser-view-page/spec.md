# kit-65-browser-view-page: spec

The live browser view page, `docs/devteam/dashboard/browser.html`: the supervisor's browser screen on a canvas, the owner's clicks, wheel, keys and pastes sent back, an address bar, Back, and **Sign out of everything**. Tested in real Chrome against a fake socket server by `test/browser-view-page.test.mjs`.

Feature `supervisor-browser`, stories SB-S2 (the owner completes a login in the live view) and SB-S3 (the owner signs it out of everything from the view). Design: home's `project/designs/supervisors-can-use-a-browser-with-the-o.md`, Components §4 (the live view server and page), Contracts (the socket messages), Security (the mask, keys never logged). Mock the owner settled on: home's `project/artifacts/browser-handover/` (step 2, the live view). Kind `build`, size S, **risk high** (two final reviews from other sessions). Depends on kit-61 (merged, PR #243).

## Why

kit-66 serves this page from the browser daemon and wires its socket to Chrome; kit-67 and kit-68 put the owner in front of it. This ticket builds the page alone, against `browser@1`'s socket messages, so it can be tested without a daemon or a Chrome to drive: a fake server replays the contract's fixtures and records what the page sends.

## Contracts

**Consumed:** `docs/devteam/schema/browser.schema.json@1`, `$defs.view` only:

- from the server: `frame {data, w, h, seq}`, `url {url}` (masked), `held {qid|null}`, `bye {why}`;
- from the page: `mouse`, `wheel`, `key`, `paste`, `nav`, `back`, `forget`, each exactly the shape there (closed objects: no extra field).

Fixtures used: `test/fixtures/browser/view-from-server.json` (replayed by the fake server), `view-from-page.json` (the shapes the page's messages are compared with).

**Provided (to kit-66, not a versioned contract):** the page's own expectations of its server, which kit-66's spec must match. The test pins them; this spec names them so kit-66 can read them here:

1. **The socket is at `/socket` on the page's own origin**: `ws://<host>/socket` when the page is `http:`, `wss://<host>/socket` when it is `https:` (the box gateway). No query, no token, no subprotocol.
2. **The page is self-contained**: one HTML file with its style and script inline. It loads nothing else, so the server serves only it and the socket.
3. **The page's own CSP**, in a `<meta http-equiv="Content-Security-Policy">`: `default-src 'none'; script-src 'sha256-<its script>'; style-src 'sha256-<its style>'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'`. A server CSP header, if kit-66 or the gateway sends one, only narrows it further (both apply). `frame-ancestors` can't be set from a meta tag; framing stays the server's and the gateway's to rule on.
4. **Sizes.** A `paste` the page sends is at most 10 000 characters of text, which JSON can grow to about 60 KB (`\u` escapes); the server's socket must take a message that size. Frames come the other way at whatever size the screencast makes; the page puts no limit on them.
5. **Coordinates are frame pixels** (the contract's words). Turning them into the CSS pixels `Input.dispatchMouseEvent` takes (the screencast's `deviceWidth` and `pageScaleFactor`) is the server's job.
6. **After `bye`** the page closes its own socket and opens no other until the owner asks; the server may close it first.

## What the page does

Plain DOM, no library, plain words (design R2). Laid out after the mock's step 2, without its window dots or the mock's own site: a bar (Back, address, Sign out of everything), the screen, a foot line. Light and dark, from `prefers-color-scheme`. Running text sits under the owner's width rule (never wider than 6 of 12 columns at full desktop width: the overlays and messages get a `max-width` of half the page's max width).

### The screen

- **Frames.** On `frame`, the page decodes `data` (base64 JPEG) with `createImageBitmap` on a Blob (so the CSP needs no `img-src`), sets the canvas's `width` and `height` to the frame's `w` and `h`, and draws it. The canvas is scaled by CSS to fit both the page's width and the height left under the bar (`max-width: 100%`, `max-height` the viewport less the bars, aspect kept), so the whole remote viewport is always on screen: a submit button at its bottom is never below the fold, and the wheel scrolls the remote page, not this one.
- **Order.** Decoding is async: a frame whose `seq` is lower than the last one drawn on this socket is dropped, so a slow decode never paints an older frame over a newer one. A new socket starts the count again.
- **Bad frames.** A frame that fails to decode, or with `w`/`h` outside the contract, is skipped; the last good one stays.
- **Before the first frame** the screen says "Connecting to the supervisor's browser…".

### Input from the owner (on the canvas only)

Coordinates are frame pixels: `x = (clientX − canvas.left) × w / canvas.width_on_screen`, clamped to `[0, w]`, likewise `y`; `w × h` is the last frame drawn. With no frame drawn yet, nothing is sent. The page listens to pointer events and captures the pointer on a press (`setPointerCapture`), so a drag released outside the canvas still sends its `up`, clamped to the edge.

| The owner does | The page sends |
|---|---|
| a click: a press and release of one button within 4 px of the press | one `mouse {type:"click", x, y, button, clicks, mods}` at the press point; `clicks` is the event's `detail`, clamped to 1 to 3 (2 for a double click). The press itself sends nothing until it is known to be a click |
| a drag: the pointer goes more than 4 px from the press with the button held | `mouse {type:"down"}` at the press point, then `move`s carrying that `button` (at most one per animation frame), then `up` at the release. A move still waiting for its animation frame when the button comes up is sent before the `up`, never after |
| move with no button held | `mouse {type:"move", x, y, button:"none"}`, at most one per animation frame |
| a wheel turn | one `wheel {x, y, dx, dy, mods}` in pixels (line mode ×16, page mode × the frame's height), each delta clamped to ±100 000; the page itself doesn't scroll (default prevented) |
| a printable key: one character, with no Ctrl or Meta held, or with AltGr (`getModifierState('AltGraph')`, or Ctrl and Alt together on Windows: how `@` is typed on many layouts) | one `key {type:"press", key, code, text: key}` on keydown, nothing on its keyup |
| Enter | one `key {type:"press", key:"Enter", code, text:"\r"}` |
| any other key (Backspace, Delete, Tab, Escape, the arrows, Home, End, Page Up/Down, a Ctrl or Meta chord such as Ctrl+A) | `key {type:"down", key, code, mods}` on keydown and `key {type:"up", key, code}` on keyup |
| a modifier alone (Shift, Control, Alt, Meta, AltGraph, CapsLock) | nothing: what it does is carried as `mods` on the next message that needs it (Shift+click is a `click` with `mods: 8`, Shift+Tab a Tab `down` with `mods: 8`) |
| a paste: Ctrl+V, Cmd+V or Shift+Insert | `paste {text}`, the clipboard's plain text. Up to 10 000 characters is one message; longer text goes in pieces of at most 10 000 characters cut between code points (never through a surrogate pair), in order, up to 100 000 characters in all. Over that, nothing is sent and the page says "That paste is too long to send." The paste chord itself sends no `key` message, so the remote page never also pastes its own clipboard. An empty paste sends nothing |

`mods` is CDP's bitmask (Alt 1, Ctrl 2, Meta 4, Shift 8), omitted when 0. Every key the page sends has its default prevented (so Space, the arrows, Tab and Backspace move nothing on this page); the paste chords don't, so the browser's own `paste` event fires. The canvas's context menu is prevented (it would offer this page's menu, not the remote one's). The canvas takes focus on a press (`tabindex="0"`) and shows a focus ring; keys typed elsewhere on the page (the address bar, the dialog) never reach it.

**Nothing is queued.** While the socket isn't open, input is dropped, not buffered: a password typed during a reconnect is never replayed later into whatever page is up by then. Nothing the owner types or pastes is logged (no `console` call carries it), stored (no storage API is used at all) or put in the DOM.

### The address bar

- Shows the server's `url` messages exactly as sent (masked). It doesn't overwrite what the owner is typing: while the field has focus, the newest `url` waits and is shown on blur or after a nav.
- **Enter sends `nav`** with what was typed, trimmed and, where it has no scheme, with `https://` in front:
  - a value with `://` is parsed as a URL as is;
  - a value that begins with a scheme (`name:` where what follows isn't a port, so `javascript:`, `file:`, `data:`, `about:`, `chrome:`) is parsed as is;
  - anything else gets `https://` in front (`shop.example/account`, `localhost:8080`: the guard decides where it may go).
  - The page sends `nav {url}` only when the result parses and its protocol is `http:` or `https:` and it is at most 2048 characters. Otherwise it sends nothing and says under the bar, in words: "Only http and https addresses open here." (or "That address is too long."). The server checks again (design §4); this is the page's own check.
- **Back** (the ← button, labelled "Back") sends `back`.

### Sign out of everything

The button opens a `<dialog>`: "Sign this project's browser out of every site? Every site it is signed into forgets it, and the browser starts again empty." with **Sign out of every site** and **Cancel**. Only the first sends `forget`; Cancel, Escape or closing it send nothing.

### The foot line: who has the browser

- `held` with a qid: **"When you're done, press Done on the card."**
- `held` with `null`: "The supervisor has the browser. You can watch."
- No `held` yet: nothing.

The page has **no Done, no hand-back and no answer control** of any kind (design §4: its server runs as the agent, so a hand-back from it would be the agent's). Input is sent whatever `held` says; the server decides what reaches Chrome (kit-66, kit-67).

### Connection

- On load the page opens the socket. A status chip says "Live" while it is open, "Connecting…" before, and "Reconnecting…" after a drop.
- **A close without `bye`** (the server restarted, the network dropped, the daemon came back): the page reconnects by itself, after 0.5 s, then doubling up to 5 s between tries, back to 0.5 s once a socket opens. The last frame stays on screen, dimmed, while it is down.
- **`bye`**: the page shows `why` in a panel over the screen ("The supervisor has the browser again."), with "You can close this page." and a **Show it again** button that reconnects, closes its socket, and does **not** reconnect by itself (a second viewer that got `bye` must not fight the first one in a loop). `why` is shown as text (`textContent`), never as HTML.
- A message that isn't JSON, has no known `t`, or doesn't match its shape is ignored, and the page carries on.

## Acceptance checks (the done-whens, restated)

All in `test/browser-view-page.test.mjs`, which uses `test/lib/chrome.mjs` (real headless Chrome over CDP, real `Input.dispatch*` events) and a fake socket server written in the test (Node's `http` plus a minimal RFC 6455 framer: no dependency).

**Not skipped in CI.** The test is skipped only when `canDrive` is false; on CI (`process.env.CI` set) with Node 22 or later and no Chrome it fails instead of skipping, so it can't pass the Node 22 and 24 jobs by skipping. On Node 18 and 20 it skips (no `WebSocket`).

1. **Frames, url, held.** The fake server serves `browser.html` and, on `/socket`, replays `view-from-server.json` in order: after each frame the canvas's `width`×`height` equal that frame's `w`×`h` (160×100, then 320×200) and its pixels are not blank (a drawn JPEG); after the url message the address bar shows it exactly, `•••` included; after `held` with the qid the page shows "When you're done, press Done on the card"; after `held: null` it doesn't.
2. **Input.** With a 320×200 frame drawn and the canvas shown at another on-screen size, each of these, done with real CDP `Input.*` events, makes the server receive exactly the messages listed (mouse `move`s from the helper's pointer travel before a press are left out of the count), each valid against its `from_page` shape, with `x`, `y` the on-screen point scaled to the frame (within 1 px):
   - a click: one `mouse click`, `button: "left"`, `clicks: 1`; a Shift+click: one `click` with `mods: 8` and no `key` message;
   - a drag: `down`, at least one `move` with `button: "left"`, `up`, in that order;
   - a wheel turn: one `wheel` with its `dy`;
   - typed text "ab": two `key press`es with `text` "a" and "b"; Enter: one `key press` with `text: "\r"`;
   - a real paste (clipboard permission granted, `navigator.clipboard.writeText` under focus emulation, then Ctrl+V with CDP's `paste` command): one `paste` with that text and no `key` message;
   - an address-bar entry `https://shop.example/account`: one `nav` with that URL; Back: one `back`;
   - Sign out of everything: nothing until its confirm; Cancel: nothing; confirming: one `forget`.
3. **The address bar.** It shows `https://shop.example/account/login?next=•••` as sent. `javascript:alert(1)`, `file:///etc/passwd`, `data:text/html,x`, `about:blank` and `chrome://settings` send nothing and show the refusal line; `shop.example/account` sends `nav` with `https://shop.example/account`; `http://` and `https://` addresses send as typed.
4. **No hand-back, CSP, reconnect, bye.**
   - No button, link or input whose text, label or value says Done, hand back or give back exists in the page, in any state of the test.
   - The page's meta CSP is the one above, and its hashes are the sha-256 of the page's one `<script>` and one `<style>` (so they can't go stale); the page has no `src` or `href` attribute naming another origin; in Chrome, a script and a stylesheet the test injects from a second loopback server's origin are refused (`securitypolicyviolation` fires, and that server gets no request).
   - When the fake server closes the socket (no `bye`), the page opens a new one within 3 s and draws its frames.
   - On `bye`, the page shows its `why` text, closes its socket, and opens no new one by itself in the next 3 s; **Show it again** opens one.
5. **What the owner types goes nowhere else** (spec, Nothing is queued; design, Security):
   - with the socket closed by the server, a marker string typed and pasted into the canvas, then the socket back: the server never receives it;
   - after typing and pasting a marker while connected: no `console` message (CDP `Runtime.consoleAPICalled`) carries it, `localStorage`, `sessionStorage` and IndexedDB hold nothing, and the page's DOM (`document.documentElement.outerHTML` and every input's value) doesn't contain it.
6. **The rest of the screen's rules:**
   - a message that isn't JSON, one with an unknown `t`, and a `frame` with `w: 0` or bad `data` are ignored: no page exception (CDP `Runtime.exceptionThrown`), the last good frame's size stays, and the next good frame draws;
   - frames with `seq` 5 (320×200) then `seq` 4 (160×100): the canvas stays 320×200;
   - after `held: null` the foot line says "The supervisor has the browser. You can watch."

## Edge cases

- A frame arriving before any `held` or `url`: drawn.
- Two frames whose decodes finish out of order: the higher `seq` stays.
- The window resized: coordinates follow, since each event reads the canvas's on-screen box.
- A HiDPI screen: the canvas's own size is the frame's, so `devicePixelRatio` plays no part in the scale.
- A key held to repeat: each repeat of a printable key is a `press`, of another key a `down` (CDP's own repeat form).
- A press that never ends (the pointer capture lost, the window losing focus): the page sends the `up` for a `down` it sent, at the last point, when the capture is lost; a press still waiting to be a click sends nothing.
- IME composition: a canvas isn't editable, so no composition starts there; a keydown with `isComposing` set is ignored.
- `why` or `url` holding `<b>` or a script tag: shown as text.

## Out of scope

- The server, the socket's Host/Origin checks, one-viewer-at-a-time, wiring to CDP `Input.*` and `Page.navigate`: kit-66.
- Dropping input once the handover closes, and the hold itself: kit-67.
- Opening it from the card (preview frame or new tab) and through the gateway: kit-66, kit-67, kit-68.
- The mock's "Back to the card" button: the page doesn't know the dashboard's address (on the box it is another host), and a link to it would be a second way off the page with nothing to hand back. Leaving it out; the card stays where the owner left it.
- Touch input (a phone): a tap arrives as mouse events in Chrome and Safari, so it clicks; pinch, long-press and a phone's keyboard are left for later.
- Copying out of the remote page (its clipboard): not in the contract.

## Rulings

The rulings made after this spec was approved are in `plan.md`, Rulings, which wins where the two differ (final review FB5):

- m-20261115-035923461-supervisor: `clicks` is counted by the page (within 500 ms and 4 px, up to 3), not read from the event's `detail`; console and errors are caught by a recorder in the page's world, not CDP events.
- The worker's ruling on task review T3-4: only a leading scheme is parsed as is; the "value with `://`" rule is gone.
- m-20261115-055236676-supervisor (final-1 F2): Sign out is off with no open socket; a confirm pressed after a drop says "Not connected: nothing was signed out."
- m-20261115-055916125-supervisor (final-1b FB4): an address or Back with no open socket says "Not connected: not sent."
