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

## What the page does

Plain DOM, no library, plain words (design R2). Laid out after the mock's step 2, without its window dots or the mock's own site: a bar (Back, address, Sign out of everything), the screen, a foot line. Light and dark, from `prefers-color-scheme`. Running text sits under the owner's width rule (never wider than 6 of 12 columns at full desktop width: the overlays and messages get a `max-width` of half the page's max width).

### The screen

- **Frames.** On `frame`, the page decodes `data` (base64 JPEG) with `createImageBitmap` on a Blob (so the CSP needs no `img-src`), sets the canvas's `width` and `height` to the frame's `w` and `h`, and draws it. The canvas is scaled by CSS to the page's width, keeping its aspect.
- **Order.** Decoding is async: a frame whose `seq` is lower than the last one drawn on this socket is dropped, so a slow decode never paints an older frame over a newer one. A new socket starts the count again.
- **Bad frames.** A frame that fails to decode, or with `w`/`h` outside the contract, is skipped; the last good one stays.
- **Before the first frame** the screen says "Connecting to the supervisor's browser…".

### Input from the owner (on the canvas only)

Coordinates are frame pixels: `x = (clientX − canvas.left) × w / canvas.width_on_screen`, clamped to `[0, w]`, likewise `y`; `w × h` is the last frame drawn. With no frame drawn yet, nothing is sent.

| The owner does | The page sends (one message unless said) |
|---|---|
| a click (press and release at one point, same button) | `mouse {type:"click", x, y, button, clicks, mods}`; a press and release apart (a drag) sends `down` at the press and `up` at the release, with `move`s between, throttled to one per animation frame |
| move without a button held | `mouse {type:"move", x, y, button:"none"}`, at most one per animation frame |
| a wheel turn | `wheel {x, y, dx, dy, mods}` in pixels (line mode ×16, page mode × the frame's height); the page itself doesn't scroll |
| a printable key (one character, no Ctrl or Meta) | `key {type:"press", key, code, text: key}` on keydown, nothing on its keyup |
| Enter | `key {type:"press", key:"Enter", code, text:"\r"}` |
| any other key (Backspace, Tab, arrows, Escape, a modifier, a Ctrl or Meta chord) | `key {type:"down", …}` on keydown and `key {type:"up", …}` on keyup, with `mods` when any is held; Tab and Backspace are kept in the canvas (default prevented) |
| a paste (Ctrl+V, Cmd+V, the context menu) | `paste {text}`, the clipboard's plain text; one message for up to 10 000 characters, longer text in 10 000-character pieces in order. Ctrl+V and Cmd+V send no `key` message, so the remote page never also pastes its own clipboard. An empty paste sends nothing |

`mods` is CDP's bitmask (Alt 1, Ctrl 2, Meta 4, Shift 8), omitted when 0 on keys. The canvas takes focus on a click (`tabindex="0"`) and shows a focus ring; keys typed elsewhere on the page (the address bar) never reach it.

**Nothing is queued.** While the socket isn't open, input is dropped, not buffered: a password typed during a reconnect is never replayed later into whatever page is up by then. Nothing the owner types or pastes is logged, stored (no storage API is used at all) or put in the DOM.

### The address bar

- Shows the server's `url` messages exactly as sent (masked). It doesn't overwrite what the owner is typing: while the field has focus, the newest `url` waits and is shown on blur or after a nav.
- **Enter (or Go) sends `nav`** with what was typed, trimmed:
  - a value with `://` is parsed as a URL as is;
  - a value that begins with a scheme (`name:` where what follows isn't a port, so `javascript:`, `file:`, `data:`, `about:`, `chrome:`) is parsed as is;
  - anything else gets `https://` in front (`shop.example/account`, `localhost:8080`: the guard decides where it may go).
  - The page sends `nav {url}` only when the result parses and its protocol is `http:` or `https:` and it is at most 2048 characters. Otherwise it sends nothing and says under the bar, in words: "Only http and https addresses open here." (or "That address is too long."). The server checks again (design §4); this is the page's own check.
- **Back** (the ← button, labelled "Back") sends `back`.

### Sign out of everything

The button opens a `<dialog>`: "Sign this project's browser out of every site? Every site it is signed into forgets it, and the browser starts again empty." with **Sign out of every site** and **Cancel**. Only the first sends `forget`; Cancel, Escape or closing it send nothing.

### The foot line: who has the browser

- `held` with a qid: **"When you're done, press Done on the card."**
- `held` with `null`: "The supervisor has the browser."
- No `held` yet: nothing.

The page has **no Done, no hand-back and no answer control** of any kind (design §4: its server runs as the agent, so a hand-back from it would be the agent's). Input is sent whatever `held` says; the server decides what reaches Chrome (kit-66, kit-67).

### Connection

- On load the page opens the socket. A status chip says "Live" while it is open, "Connecting…" before, and "Reconnecting…" after a drop.
- **A close without `bye`** (the server restarted, the network dropped, the daemon came back): the page reconnects by itself, after 0.5 s, then doubling up to 5 s between tries, back to 0.5 s once a socket opens. The last frame stays on screen, dimmed, while it is down.
- **`bye`**: the page shows `why` in a panel over the screen ("The supervisor has the browser again."), with "You can close this page." and a **Show it again** button that reconnects, and does **not** reconnect by itself (a second viewer that got `bye` must not fight the first one in a loop). `why` is shown as text (`textContent`), never as HTML.
- A message that isn't JSON, has no known `t`, or doesn't match its shape is ignored.

## Acceptance checks (the done-whens, restated)

All in `test/browser-view-page.test.mjs`, which uses `test/lib/chrome.mjs` (real headless Chrome over CDP, real `Input.dispatch*` events) and a fake socket server written in the test (Node's `http` plus a minimal RFC 6455 framer: no dependency).

**Not skipped in CI.** The test is skipped only when `canDrive` is false; on CI (`process.env.CI` set) with Node 22 or later and no Chrome it fails instead of skipping, so it can't pass the Node 22 and 24 jobs by skipping. On Node 18 and 20 it skips (no `WebSocket`).

1. **Frames, url, held.** The fake server serves `browser.html` and, on `/socket`, replays `view-from-server.json` in order: after each frame the canvas's `width`×`height` equal that frame's `w`×`h` (160×100, then 320×200) and its pixels are not blank (a drawn JPEG); after the url message the address bar shows it exactly, `•••` included; after `held` with the qid the page shows "When you're done, press Done on the card"; after `held: null` it doesn't.
2. **Input.** With a 320×200 frame drawn and the canvas shown at a different on-screen size, a real click, a wheel turn, typed text ("ab"), Enter and a real paste (CDP clipboard write, then Ctrl+V) each make the server receive exactly one message, valid against its `from_page` shape, with `x`, `y` equal to the on-screen point scaled to the frame (within 1 px). An address-bar entry sends `nav` with what was typed; Back sends `back`. Sign out of everything sends nothing until its confirm; Cancel sends nothing; confirming sends `forget`.
3. **The address bar.** It shows `https://shop.example/account/login?next=•••` as sent. `javascript:alert(1)`, `file:///etc/passwd`, `data:text/html,x`, `about:blank` and `chrome://settings` send nothing and show the refusal line; `shop.example/account` sends `nav` with `https://shop.example/account`; `http://` and `https://` addresses send as typed.
4. **No hand-back, CSP, reconnect, bye.**
   - No button, link or input whose text, label or value says Done, hand back or give back exists in the page, in any state of the test.
   - The page's meta CSP is the one above, and its hashes are the sha-256 of the page's one `<script>` and one `<style>` (so they can't go stale); the page has no `src` or `href` attribute naming another origin; in Chrome, a script and a stylesheet the test injects from a second loopback server's origin are refused (`securitypolicyviolation` fires, and that server gets no request).
   - When the fake server closes the socket (no `bye`), the page opens a new one within 3 s and draws its frames.
   - On `bye`, the page shows its `why` text, and opens no new socket by itself in the next 3 s; **Show it again** opens one.

## Edge cases

- A frame arriving before any `held` or `url`: drawn.
- Two frames whose decodes finish out of order: the higher `seq` stays.
- The window resized: coordinates follow, since each event reads the canvas's on-screen box.
- A HiDPI screen: the canvas's own size is the frame's, so `devicePixelRatio` plays no part in the scale.
- A key held to repeat: each repeat of a printable key is a `press`, of another key a `down` (CDP's own repeat form).
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

None yet.
