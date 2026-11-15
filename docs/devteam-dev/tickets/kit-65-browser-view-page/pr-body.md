The live browser view page, `docs/devteam/dashboard/browser.html`: the supervisor's browser screen on a canvas, the owner's clicks, wheel, keys and pastes sent back as `browser@1` view messages, an address bar, Back, and **Sign out of everything** behind a confirm. kit-66 serves it and wires its socket to Chrome; this ticket builds and tests the page alone, against a fake socket server.

Feature `supervisor-browser` (SB-S2, SB-S3). Spec, plan, reviews and verification: `docs/devteam-dev/tickets/kit-65-browser-view-page/`.

## What it does

- **Screen:** each `frame` decoded with `createImageBitmap` and drawn at its `w`×`h`; the canvas fits the window up and down, aspect kept; an older `seq` never paints over a newer one; a frame, `url`, `held` or `bye` outside the contract is ignored.
- **Address bar:** shows `url` exactly as sent, and only when it matches the contract's mask (`x-masked-url`, held equal by a test); refuses every scheme but http and https before sending `nav`; never overwrites what the owner is typing.
- **Input:** clicks (4 px rule, counted by the page), drags with pointer capture, throttled moves, wheel in pixels, printable keys as one `press`, AltGr, other keys as `down`/`up`, modifiers carried as `mods`, pastes in whole pieces up to 100 000 characters; each message checked against its closed `from_page` shape.
- **Never silent:** with no open socket, Sign out of everything is off, and an address or Back says "Not connected: not sent." (a confirm that races a drop says "Not connected: nothing was signed out."); nothing typed while down is queued.
- **Who has it:** "When you're done, press Done on the card." while `held` is a qid. The page has no Done or hand-back control.
- **Connection:** reconnects by itself (0.5 s doubling to 5 s); on `bye` shows the reason as text, closes its socket and waits for **Show it again**.
- **CSP:** a meta policy that allows only the page's own inline script and style, by sha-256, and a socket to its own origin; a test recomputes both hashes and checks Chrome refuses a script and a stylesheet from another origin.

## For kit-66

The page expects its socket at `/socket` on its own origin (`ws:` or `wss:`), serves nothing else, sends coordinates in frame pixels, sends a `paste` of up to 10 000 characters (about 60 KB of JSON at worst), and closes its socket on `bye` (spec, Contracts, Provided 1 to 6).

## How to verify

`node --test --test-concurrency=2 test/browser-view-page.test.mjs` on Node 22 or 24 with Chrome (CI's ubuntu-latest has it). On CI's Node 22 and 24 the test fails rather than skips if Chrome is missing; on 18 and 20 it skips (no `WebSocket`). See `verification.md`.

## Doesn't defend against

Per the supervisor's ruling (m-20261115-034535632-supervisor): nothing the owner types is logged, kept in the page's memory after it is sent (a test walks every closure the page's listeners reach, and a mutation that keeps the last key fails it), or reachable by another origin (no global, no `message` listener, no storage; a page of another origin that frames it can't read it). What the page can't defend against: a browser extension or devtools in the owner's own browser, anything running as the owner's OS user on their machine, and the server it sends to. kit-66's daemon runs as the agent; the page trusts it to forward input to Chrome and drop it, never to store it, and every other process running as that user can reach the same daemon (design, Security, P6).

## Not in this PR

`README.md`'s kit file list (it doesn't name `browser.schema.json` or `browser.html` yet) is kit-69's (touches README.md).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
