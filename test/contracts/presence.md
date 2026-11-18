# Live presence

Contract `presence@1`. Provided by `devteam.mjs` (the relay on each dashboard server and on the hub server; the hello's `present`) and the gateway (`cloud/gateway.mjs`). Used by the shell's JS block in `index.html` and `hub.html`, the artifact viewer and lens (`ARTIFACT_LENS`), and the hub (`hub.html`: `hub-visible` and the hello's `present`). `test/presence-contract.test.mjs` holds this document, its fixtures (`test/fixtures/presence/`) and its fake relay (`test/lib/presence-fake.mjs`, §12) to one another.

Sizes are bytes of UTF-8; a KB is 1024 bytes.

## 1. Consumers and providers

Provided by `devteam.mjs` (the relay on each dashboard server and on the hub server; the hello's `present`) and the gateway (`cloud/gateway.mjs`). Used by the shell's JS block in `index.html` and `hub.html`, the artifact viewer and lens (`ARTIFACT_LENS`), and the hub (`hub.html`: `hub-visible` and the hello's `present`). The fake (§12) and the fixtures stand in for the relay in page tests.

Version: `presence: 1` in `welcome`; additive changes only, anything else bumps it. The reader's half of additive: a page ignores keys it doesn't know and server messages whose `t` it doesn't know.

## 2. The socket

`GET /presence` with `Upgrade: websocket`, `Sec-WebSocket-Version: 13` and a `Sec-WebSocket-Key` of 16 bytes in base64, on a dashboard's server and on the hub's; a query string is ignored; RFC 6455's handshake (`Sec-WebSocket-Accept`), no subprotocol, no extension (no compression). An upgrade skips the request handler, so the upgrade path runs the same guards the dashboard's request path runs, in the same order, then its own. Refused, before any upgrade, in this order (the first that applies answers):

- a `Host` `okHost` rejects: 403 (DNS rebinding);
- a request carrying `x-devteam-relay`, any value (the preview relay's mark, set on every upgrade it forwards with Host and Origin rewritten to the target's): 403;
- any path but `/presence`: 404;
- not a valid WebSocket upgrade (no `Upgrade: websocket`, a version other than 13, a missing or malformed key): 400;
- `Origin` absent, `null` (a sandboxed artifact frame) or not equal to `http://<Host>`: 403 (on a box the gateway checks its own `https://<host>`, then forwards to the dashboard's loopback Host as it does every request);
- an `x-devteam-person` or `x-devteam-level` that breaks §4: 403 (refused, never a fall back to the owner).

**The gateway's part** (kit-632): it forwards `/presence` on a project host and on the box's own host, only with a session and only from the same origin, sets `people@1`'s person and level headers on it (stripping any the browser sent), lets View sessions hold it (org-access's View allow-list gains `/presence` and nothing else), records each socket against the session that opened it and closes it when that session ends: sign-out, expiry, removal, or a level change.

**Frames.** Client frames must be masked. Payload lengths in the 7-, 16- and 64-bit forms are all read, a longer form for a short payload included (lenient). A frame header is checked for validity before its length (an unmasked frame, a reserved bit, an unknown opcode, a 64-bit length with its top bit set and every other protocol error of §3 is 1002, never 1008). A message may come in a text frame then continuations, at most 16 frames, with control frames between them. Ping is answered with a pong of the same payload; a close is answered with a close and the socket ended. Every data message is one JSON object in one text message. Server frames are unmasked and unfragmented. The 2 KB limit (§7) is checked on each frame header's declared length, added to what the message holds so far, before any of that payload is read or kept: over it, the connection is closed at once.

## 3. Close codes

`1008` for anything over a limit (§7) and for a message a page must not send: binary, not JSON, not a JSON object (`[]`, `null`, a number), over 2 KB, more than 16 frames. `1002` for a protocol error, found on the frame header before its length is weighed: an unmasked client frame, a reserved bit set, an unknown opcode, a control frame that is fragmented or carries more than 125 bytes, a continuation with nothing to continue, a text frame while a message is still open, a 64-bit length with its top bit set. `1001` when two pings go unanswered. These are the three codes. A handler that throws closes only that connection (1011); the server keeps running.

## 4. Who you are

Only from the upgrade's headers, never from a message. Each header appears at most once (`rawHeaders`); a repeated one is refused.

- `x-devteam-person` is `<id>;name=<name>`, exactly: `id` 1 to 64 characters of the `at` set (§5); `;name=` required, with no other parameter; `<name>` only unreserved characters (`A-Z a-z 0-9 - _ . ! ~ * ' ( )`) and `%XX` escapes that decode as valid UTF-8, non-empty once decoded. The decoded name is cut, by whole characters, to the longest start whose JSON string encoding (without its quotes) is at most 80 bytes.
- `x-devteam-level` is exactly `full` or `view` (case and spaces matter). Absent with a person, it is `full`. Present without a person, it is refused (a View level never becomes the owner).
- With neither header (a laptop, or a gateway before org-access) the connection is id `owner`, named as the instance's owner, level `full`.
- A connection's own id is `conn`: 1 to 32 characters of the `at` set, unique on its server while the server runs.

## 5. Where you are: at

`{ "page", "tab", "peek", "art", "thread" }`, each null or a string of 1 to 120 characters from `A-Z a-z 0-9 . _ - : @ /` (`^[A-Za-z0-9._:@/-]{1,120}$`). A value outside the set or over 120 characters is sent as `h:` and the first 16 lowercase hex characters of the SHA-256 of its UTF-8 bytes, which the page computes; `h:…` is itself in the set, two people on the same file still match, and the popover says "a file". The server keeps only those five keys, makes any part that isn't a string in the set null (a missing key included), and builds `at` afresh from the checked strings; none ever needs escaping in JSON.

- `page`: the head's page. `tab`: the value of the page's one tab key (`gt` on Goals, `lt` on Self Improvement, `st` on Sensors, declared in one table beside `STATE_KEYS`), or null; filters (Board's `goal`, Library's `kind`, Progress's `narrow`) are never a tab. `peek`: `p` when it names a record (a ticket, goal, question or file), without a version and without `dashboard-shell@3`'s `view`. `art`: `p` when it names an artifact, as `<slug>@<version>`, `main` when none. `thread`: the thread open in Threads or on a pin.
- **The same spot** is `page`, `tab`, `peek` and `art` all equal (null equals null). `thread` isn't part of it; faces on a thread use `thread` alone.

## 6. Messages

From the page:

- `{ "t": "here", "at": {…}, "visible": true|false }`, first, then whenever a part changes and when the page is hidden or shown. A `here` whose `at` isn't a JSON object is ignored; a `visible` that isn't `true` counts as false. A connection that hasn't sent a `here` the server took is listed nowhere, gets no `people`, `move` or `changed`, and its `move` is dropped. A `here` that changes nothing sends no `people`.
- `{ "t": "move", "a": { "k", "x", "y" } | null }`: the pointer as a fraction across an anchor, null when it leaves. At most 15 a second; the page drops moves in between, never queues them.
- `{ "t": "pong" }`, answering `ping`.
- Any other `t` is ignored (additive). Any `id`, `conn`, `name` or `level` in a page's message is ignored.

From the server:

- `{ "t": "welcome", "presence": 1, "you": { "id", "conn" } }`, first, before any other message.
- `{ "t": "people", "people": [ { "id", "name", "level", "conns": [ { "conn", "at", "visible" } ] } ] }`: every person on this server with a connection that has said `here`, in full, one entry per person, people and their conns in the order they first said `here`; sent to every connection that has said `here`, whenever anyone arrives, leaves, or changes `at` or `visible`, at most one every 250 ms: the first change opens a 250 ms window, and one message at its end carries all of them.
- `{ "t": "move", "id", "conn", "a" }`: `id` and `conn` the sender's own, from its upgrade and its connection, never from the page's message; `a` built from checked fields, never the page's JSON: null, or `k` a string of 1 to 200 bytes and `x`, `y` finite numbers in 0..1. A `move` whose `a` is neither is dropped. Sent only to connections whose last `here` said `visible: true`, on the same spot as the sender (whose own last `here` said visible), and never to any connection of the sender's own person.
- `{ "t": "changed" }`, from a project's dashboard when its log grows, to every connection that has said `here`, at most every 500 ms: a growth inside the window is sent at its end, never dropped. The hub sends none.
- `{ "t": "ping" }` every 20 s; when two pings in a row have had no `pong` by the time the next is due, the connection is closed (1001).

**Anchors.** On dashboard pages `k` is the `data-presence` value of the nearest element carrying one (record rows and cards: the record's id; sections; the page body as the fallback). Inside an artifact `k` is the lens's CSS selector for the element under the pointer: the selector alone, never the text fallback pins use.

## 7. Limits

A page's message at most 2 KB (2048 bytes, the whole message once its frames are joined, checked as §2 says); a server's at most 256 KB (262144 bytes). 30 messages a second per connection, counting each whole data message (a `here` included) and each control frame, per whole second from the connection's open: beyond 30 in a second, a `move`, a ping frame or a message of unknown `t` is dropped, while a `here`, a `pong` and a close are never dropped, whatever the rate (a close is never counted), so a page's spot and its ping answers survive its own flood; a connection over 30 in each of 10 seconds in a row is closed. 8 connections per person per server, 200 per server, counted from the handshake: one over is accepted and closed at once, before `welcome`, so the page reads the code. Every close over a limit is code 1008, and the page waits (its backoff) before trying again. The bound's sum, as encoded JSON: a connection's entry in `people` is at most about 750 bytes, a person's own fields at most about 250; 200 people with one connection each is about 200 KB, inside 256 KB.

## 8. The page

Reconnects with backoff (1, 2, 4 … up to 30 s). While disconnected, faces grey out with "Reconnecting", cursors stop, and the page polls as today. It escapes every name and every `at` word where it draws them, finds anchors with `CSS.escape`, and Go there only sets `location.hash` to a head built by `headFor` from `parseHead`'s fields. It never draws its own face, and drops a cursor as soon as the latest `people` no longer puts its conn on its spot. It holds the socket only while it counts as here (§9). On `changed` it reloads the open thread and the viewer's notes at once and `/api/data` at most once every 3 s (a `changed` inside that window waits for its end).

## 9. When a page counts as here: hub-visible

A top-level page is visible when `document.visibilityState` says so. A dashboard framed by the hub is visible only while the hub shows its frame, as `dashboard-shell@3`'s `{ "devteam": "hub-visible", "visible": true|false }` says: sent by the hub when the frame's tab is chosen or left (by a click or by Back and Forward). Presence's additions to shell@3's sender: the hub also sends it to every frame when the hub's own browser tab is hidden or shown (`visible` true only when the frame is shown and the hub's tab is visible), and again, with the frame's current value, on every load of a frame (its first, a Reload after a kit update, a moved port), since the post made as a frame is created comes before its script listens. A framed dashboard that hasn't heard it counts as hidden, and obeys it only from `window.parent` at the hub's origin. A page hidden for 60 s closes its socket; it reconnects when shown.

## 10. The lens: pointer and place

Additive to `artifact-notes@1`'s lens messages, which carry `{ lens: 1, type }`, so these do too; pins, `resolve` and its watch list are unchanged:

- the lens says `{ "lens": 1, "type": "pointer", "k": "<selector>", "x", "y" }` (`k` 1 to 200 bytes, `x`, `y` in 0..1 across the element), or `{ "lens": 1, "type": "pointer", "k": null }` when the pointer leaves, at most 15 a second;
- the viewer asks `{ "lens": 1, "type": "place", "anchors": [ { "id", "k" } ] }`, at most 8 (the lens takes the first 8 of a longer list), `id` the conn, `k` a selector of 1 to 200 bytes; the newest `place` stands until the next, and an empty list stops it;
- the lens answers `{ "lens": 1, "type": "placed", "rects": [ { "id", "rect": { "x", "y", "w", "h" } | null } ] }`, in the frame's viewport in CSS pixels, rounded to whole numbers, as `rects` already is: once at once after each `place`, then at most once per animation frame and only when a rect changed; `rect` null when the selector finds nothing or the element isn't shown. It never runs the text-search fallback.

An artifact's scripts can send the same `pointer`; the name still comes from the gateway.

## 11. The hello's present

Each dashboard's hello (`/api/hello`, read by the hub, `hub: 1`) gains `present: [ { "id", "name", "level" } ]`, the people of §6's `people` in its order, at most 50, and `present_more`, the number of people left out (0 when none). Computed when the hello is read; an older kit's hello has neither. The hello's other keys belong to its own contract and presence says nothing about them. What `present` and `present_more` add, at 50 entries at the field limits, is under 16 KB as encoded bytes, well inside the 64 KB the hub reads (`probeHello` counts characters, so bytes are the stricter bound).

## 12. The fake

`test/lib/presence-fake.mjs` is a `node:http` server on `127.0.0.1`, port 0, with the `/presence` upgrade and RFC 6455 written by hand (Node built-ins only). It enforces §2 to §7 as the real relay must: the guards in §2's order, the headers (§4), framing and close codes, the 2 KB check on the header's length, `here` first, the `at` and `move` rebuilds, same-spot relay with `id` and `conn` the sender's own and no copy to the sender's person, coalesced `people`, `changed`, ping, every limit.

`export async function startPresenceFake(opts = {})` resolves to `{ url, port, close(), changed(), present(), stats(), tick(ms) }`:

- `changed()` is the log growing; `present()` returns `{ present, present_more }` as §11 computes it; `stats()` lists each open connection's `{ conn, id, here, messages, dropped, unanswered }`, so a test can wait until the fake has read what it sent.
- Options: `hub` (false; true sends no `changed`), `ownerName` ('Owner'), `serve(req, res)` for any plain request (so a page under test loads from the fake's origin), and `clock`: `'real'` (default; the contract's times) or `'manual'`, where no timer fires and time moves only by `await tick(ms)`, which fires every due timer in order (the people and changed windows, pings, the per-second count). Timing checks run on the manual clock, so a loaded machine can't move a burst across a window.

It also exports what the tests and later tickets share:

- `AT_PART` (the regular expression), `hashPart(value)` (the `h:` rule), `LIMITS` (every number of §7, §10 and §11);
- `shapeErrors(kind, message)`: the list of ways a message breaks the contract (empty when it matches), for each kind: `here`, `move`, `pong` from the page; `welcome`, `people`, `server-move`, `changed`, `ping` from the server; `lens-pointer`, `lens-place`, `lens-placed`; `hub-visible`; `hello`. Keys are exact (no missing and no extra key), except `hello`, which checks `present` and `present_more` and ignores the rest. Values are checked against every rule: each `at` part against `AT_PART`; `x`, `y` finite in 0..1; `k` 1 to 200 bytes; `level` `full` or `view`; `presence` 1; `name` non-empty and at most 80 JSON bytes; ids 1 to 64 and conns 1 to 32 characters of the set; `visible` boolean; `place` at most 8 anchors; `rect` four integers, `w` and `h` not negative; `present` at most 50, `present_more` a non-negative integer;
- `openPresence(url, { headers, origin, host })`: a test client over `net` that does the handshake and returns `{ status, you, send(obj), frame(bytes, { opcode, fin, mask, len, rsv }), messages, next(pred, ms), closed }`: `len` forces the 7-, 16- or 64-bit length form, `next` rejects when `ms` passes, and `closed` resolves to the close code, or 1006 when the socket ends without a close frame.

## 13. Not kept, not trusted

Presence is in memory only: never in the log, `run/`, a cache or disk. The socket carries no owner action. Not defended (P6): an agent on the box connecting to a loopback port with a forged `x-devteam-person`.
