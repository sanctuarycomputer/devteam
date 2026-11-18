# The terminal routes

Contract `terminal@1`. Provided by the dashboard server (`docs/devteam/scripts/devteam.mjs`) and, for the View deny and the signatures, by the gateway (`cloud/gateway.mjs`). Used by the dashboard's side panel (`index.html`'s Supervisor and Shell tabs), the gateway, and every writer to the supervisor's pane in `devteam.mjs` (§11). `test/terminal-contract.test.mjs` holds this document and its fake (`test/fixtures/term-fake.mjs`, §14) to it.

The routes let the owner watch and type into the supervisor's own tmux pane, and a plain shell at the project's root, from the dashboard. They are a snapshot relay over the dashboard's own HTTP: the server reads a pane and types bytes into it; the page draws the screen with xterm.js and posts the keys. There is no new transport.

Sizes are in bytes; a KB is 1024 bytes. `<which>` is `supervisor` or `shell`.

## 1. Consumers

| Consumer | What it uses |
|---|---|
| `index.html`'s Supervisor and Shell tabs | every route; the `why` codes (§4); `held` (§6); the fake in its tests |
| the gateway (`cloud/gateway.mjs`) | signs the two POSTs with their own domains (§3); denies View on `/api/term/*` (§4); caps the POST bodies (§3) |
| every writer in `devteam.mjs` | the owner's floor and the typing lock (§11) |
| the end-to-end test | every route, in headless Chrome against a real tmux on a scratch socket |

## 2. Where the routes answer

The routes answer only when the dashboard is bound to a loopback address: `127.0.0.1`, `localhost`, `::1`. That holds on a laptop and on a box alike; on a box the gateway proxies to loopback, and there the gateway's proof is required for the two POSTs too (`threadsNeedGateway()`). A dashboard started with `--host` on another address answers 403 `{ "why": "not-loopback" }` on every `/api/term/*` route.

Every route refuses a request marked by the preview relay (`x-devteam-relay`, why `relay`), a request carrying `x-devteam-level: view` (why `view`), and a request whose `Host` the dashboard's `okHost` rejects (why `host`).

## 3. Guards

- **The read guard.** `GET /api/term/token` needs `Sec-Fetch-Site: same-origin`, and the header must be present; without it, or with any other value, the token route refuses with why `cross-site`. A GET carries no `Origin`, so this is the strict test for a read. Screen and history are refused (why `cross-site`) when `Sec-Fetch-Site` is present and isn't `same-origin`; without the header they answer, since nothing can be typed without the token.
- **Strict same-origin** for both POSTs: `Sec-Fetch-Site: same-origin` and `Origin` equal to `http://<Host>`, both present (why `cross-site` otherwise), and `Content-Type` `application/json` (403 otherwise).
- **The token.** The token route returns `{ token }`: HMAC-SHA256, keyed by a random secret made when the server starts, over the fixed string `devteam-term-token-v1`, as hex. Its input is its own, so it is never a valid pane-answer token. It is valid until the server restarts. Every POST carries it in its body.
- **The gateway's proof** (on a box only). The headers `x-devteam-gateway-ts` (13-digit epoch ms, within `OPERATOR_PROOF_MS` of now), `x-devteam-gateway-nonce` (22 to 64 of `[A-Za-z0-9_-]`) and `x-devteam-gateway-sig` (base64url), checked as `dashboardProofProblem` checks a pane answer's. The signature is Ed25519 over a message bound to its route:
  - keys: `devteam-term-keys-v1\n<port>\n<which>\n<ts>\n<nonce>\n<sha256 hex of the body>`;
  - shell open: `devteam-term-open-v1\n<port>\nshell\n<ts>\n<nonce>\n<sha256 hex of the body>`.

  So a signature for one route, or one `which`, never verifies for another, nor for a pane answer or an owner setting. All terminal routes share one nonce map. A nonce is recorded only after its signature verifies, is accepted once, and is pruned after twice the window.
- **Body caps.** The server and the gateway both cap each POST body (keys and shell open) at 100 KB (102400 bytes) and answer over it with 413, `application/json`, `{ error }` in plain words. The server reads a body a little over the cap to its end before it answers, so the page reads the 413; one more than four times over is cut off.
- **Order of checks.** Each request is checked in this order, and the first check that fails decides the answer:
  1. the path and the method (404, 405);
  2. `host`, `view`, `relay`, `not-loopback`, `cross-site`, in that order: the first that applies is the `why`, so a View request reads `view` unless its host is wrong, and the page can hide the tabs;
  3. the content type (403);
  4. the body cap (413);
  5. JSON (400);
  6. the token (403: a body whose `token` is missing or wrong is 403, before its shape is checked);
  7. the shape (400);
  8. the gateway's proof (403);
  9. the pane (409, 423);
  10. the repeat drop (§8: a `seq` at or below the last answers 200 and types nothing);
  11. the typing lock (503).

## 4. Refusals

A refused token, screen or history request answers JSON `{ why }`. `why` is one of `view`, `not-loopback`, `cross-site`, `relay`, `host`, and nothing else.

The gateway's View deny on `/api/term/*` is a second producer of the same answer, since on a box a View request never reaches the dashboard: status 403, `Content-Type: application/json`, and the body exactly `{"why":"view"}`. The page asks for a token once on load, so on `view` it hides both tabs before either is pressed; on the others it says why.

A refused POST answers `{ error }`, in plain words with no command or code, plus `why` when the reason is one of the five. The page turns every `why` into words and never shows the code.

| Status | When |
|---|---|
| `400` | a malformed body, or a `which` that doesn't match the path |
| `403` | a guard failed |
| `404` | an unknown `/api/term/*` path or `<which>`, or `supervisor/open` |
| `405` | a known path with the wrong method |
| `409` | the pane is `gone`, or, for `supervisor`, `resolvePane`'s checks fail (a dead pane, or one at a shell prompt) |
| `413` | over a size cap |
| `423` | `pane` is no longer the route's pane: the supervisor's marked pane changed, or the target carries the wrong tag (§10) |
| `503` | the typing lock was busy for 2 s (§11); the page says the terminal is busy and to try again |

Nothing is typed on any refusal.

## 5. Token

`GET /api/term/token` answers `{ token }` (§3). A page that gets 403 asks once more; if it still gets 403, or its browser sends no `Sec-Fetch-Site` at all, the tabs say the browser can't use them and the page stops asking.

## 6. Screen

`GET /api/term/<which>/screen` answers:

```
{ v: 1, which, pane, state, cols, rows, cursor: { x, y, visible }, modes: { app_cursor, app_keypad },
  history_size, held: { count, oldest_ms, prompt }, lines, etag }
```

- `pane` is the tmux pane id, `%<n>`.
- `state` is `live` or `gone` (no pane: the supervisor isn't running, or Shell hasn't been opened).
- `cols` and `rows` are the pane's size. The pane keeps the size its own terminal gives it.
- `cursor.x` and `cursor.y` count from 0, from the top left of the visible rows (tmux's `cursor_x` and `cursor_y`).
- `modes` are booleans from `#{keypad_cursor_flag}` and `#{keypad_flag}`, so the page sets xterm's modes and arrow keys encode as the program expects.
- `history_size` is `#{history_size}`.
- `held` is the kit's lines held behind the owner's floor (§11): `count` of them, `oldest_ms` the oldest one's age in ms (0 when none), and `prompt`, `readable` or `unknown`, whether `paneState` can read the supervisor's prompt. It is `{ count: 0, oldest_ms: 0, prompt: 'readable' }` until the floor ships, and always for `shell`.
- `lines` are the visible rows, exactly `rows` of them, each with SGR escapes kept and every other escape stripped, trailing blanks trimmed (not padded to `cols`).
- When `state` is `gone`: `pane` is `null`, `cols` and `rows` 0, `cursor` `{ x: 0, y: 0, visible: false }`, both modes false, `history_size` 0, `lines` `[]`, and an etag as usual.
- `etag` is a string, also sent as the `ETag` header in double quotes. It covers every field except `held.oldest_ms`; in its place it covers only whether `held.oldest_ms` is at least 120000. So a screen with lines held still answers 304 until the waiting note is due. `If-None-Match` equal byte for byte to the quoted header answers 304 with no body; anything else (another etag, a `W/` etag, a list) answers 200.

The gateway forces `cache-control: no-store`, so the page keeps the last screen in memory and sends `If-None-Match` itself. The server reads each pane at most once per 100 ms, however many viewers ask, in one tmux call (`capture-pane -e -p -t P \; display -p -t P '<fields>'`).

## 7. History

`GET /api/term/<which>/history?before=<n>&count=<k>` answers `{ v: 1, which, pane, before, history_size, lines }`: the `k` lines, at most 500, above absolute line `n`, oldest first, read with `capture-pane -S -E` on the matching offsets.

Line 0 is the oldest line in the scrollback, and `history_size` is the first visible row's number, so `before` runs from 0 to `history_size`. Fewer lines come back when fewer exist. Once the pane reaches tmux's history limit, old lines drop off and every number shifts down, so the answer carries `history_size` as it was at this read, and the page re-anchors from it. A missing or out-of-range `before` or `count` (below 1 or above 500) is 400. The guard is the screen's.

## 8. Keys

`POST /api/term/<which>/keys` with the body `{ which, pane, page, seq, data | paste, token }`: exactly those keys, with exactly one of `data` and `paste`.

- `which` equals the path's.
- `pane` is `%<n>` and equals the route's current pane (423 otherwise).
- `page` is a random id made per page load, 16 to 64 of `[A-Za-z0-9_-]`.
- `seq` is a positive safe integer.
- `data` is hex bytes (even length, not empty), at most 4096 decoded, typed with `send-keys -t <pane> -H`.
- `paste` is text, not empty, at most 64 KB (65536 bytes) as UTF-8, typed as one buffer: `load-buffer -b devteam-term-<pid>-<n>`, then `paste-buffer -p -d -b` that name. tmux brackets it only when the program asked. A paste is never split, and never merged with keys.
- The body cap (100 KB) binds first: the page measures the JSON it would send and refuses a paste over it itself, saying it is too large, so a paste of many quotes or control characters is refused whole, never half sent. Before any multi-line paste, in either tab, the page asks "Paste N lines?".

**Order and duplicates.**
- The last taken `seq` is kept per `page` and `which`: each tab counts its own posts up from 1.
- The server handles one post at a time per pane, in arrival order. A post waits behind the one before it for that pane, so a resend that arrives while the first waits on the lock is checked only after the first is done.
- A post is taken only when its `seq` is greater than the last one taken for its `page` and `which`. The `seq` is recorded as taken the moment the send to tmux starts, so a send that fails part way is never typed again.
- A `seq` at or below the last answers 200 with the current screen and types nothing, so a resent request never types twice.
- A post refused before its send (any 4xx, or 503) doesn't use up its `seq`.
- The page keeps one post in flight per tab and queues the rest. It merges queued `data` into one post, up to 4096 bytes, never across a paste. It never retries a key post by itself: on a failure it shows the error and drops the queue.

**Success.** For `supervisor`: take the pane's typing lock, record the owner's floor (§11), send, release the lock. For `shell`: send. Then wait up to 50 ms for the screen to change, and answer the screen. A taken post and a dropped repeat both answer the screen with `taken: true` or `taken: false` added.

## 9. Shell open

`POST /api/term/shell/open` with the body `{ which: 'shell', page, token, cols, rows }`, where `cols` is an integer from 20 to 500 and `rows` one from 5 to 200, the panel's size. The guards are the keys route's, with the signer domain `devteam-term-open-v1`.

If the window is missing, the server makes it with `new-window -d -n shell -c <root>` in the project's tmux session (`tmuxSession()`), with the environment `tmuxServerEnv()` gives: no `DEVTEAM_ROLE`, `DEVTEAM_CHANNEL` or session marker, so commands there are the owner's own, never a supervisor's or the dashboard's. It tags the pane with the pane option `@devteam-shell <project root>`. On every call, a new window or a found one, it sizes the window to `cols` by `rows` (`resize-window`; the kit is the only one that sizes it), then answers the screen.

It is idempotent: a second call finds the tagged window. The server never closes the window; it goes when the tmux session does. No other `<which>` has an open route.

## 10. Which pane is which

- `supervisorPaneIn` skips any pane tagged `@devteam-shell`, in every mode, unless it is the marked supervisor pane. So whatever the owner runs in the Shell tab, the tick never takes it for the supervisor.
- The `shell` routes find their pane only by the tag, with a value equal to this project's root, in this project's session, so each project's Shell is its own. They refuse (423) a tagged pane that equals `markedPane(runDir)`.
- The `supervisor` routes refuse (423) a pane that carries the tag.

## 11. Writers

The owner's line comes first. The floor and the lock cover the supervisor's pane only: no kit writer types into the Shell pane, so its keys route takes neither.

**The floor.** While the owner is typing a line in the Supervisor tab, they have the floor: the kit types nothing into the supervisor's pane, and presses no Enter there, until the line has ended.

- The keys and paste routes record the floor on the pane as the pane option `@devteam-owner-floor`, which every process can read with tmux. They set it on every post, to one of:
  - `<epoch ms> done`, when the post's last byte is Enter (`\r`) or Ctrl+C (`\x03`);
  - `<epoch ms> open`, in every other case.
- Escape doesn't end a line, since it leaves the owner's words in the prompt.
- **Where `paneState` can read the prompt:** a floor is released only when the prompt reads `ready` (empty) or `busy` (the agent took the line), and that reading counts only after a 3 s settle from the last owner post, so a key not yet drawn doesn't read as empty. An Enter that didn't submit (one accepting a completion, or after a `\`) leaves the words in the prompt, so the floor holds. A `done` floor is also released by `dialog` or `limit` after the settle, since no line of the owner's is being typed; an `open` floor isn't, since the owner's words come back when the menu closes.
- **Where it can't** (`unknown`): a `done` floor is released 3 s after the post, and an `open` floor is never released.
- `paneAnswer` is exempt from the floor: it answers a menu whatever the floor says, because it is the owner's own press on a card. It still takes the lock.

**What the kit does while the owner has the floor.**
- `typeInto` (thread turns, `send` to the supervisor, nudges) holds its line in `run/held/`.
- `machine tell` refuses: "not told: the owner's line is open", with exit 3.
- `flushHeld` and `flushAllHeld` don't flush, even past `HELD_NO_INPUT_MS`.
- `resendLostEnter` and `enterLanded` press no Enter.

Held lines go in once the floor is released.

**An abandoned line.** The kit never types after the owner's unsent words and never clears them, however long they sit. Its held lines are only nudges: every message they announce is already in the log, and the supervisor reads it at its next tick. After 2 minutes with lines held (`held.oldest_ms` of 120000 or more), the Supervisor tab says "Messages for the supervisor are waiting until you send or clear your line." Where `held.prompt` is `unknown` it adds "Press Enter or Ctrl+C here to let them through.", because only those end the floor there. `status` shows the supervisor's pane as "owner's line open".

**The lock.** Every process that types into the supervisor's pane takes one lock for the whole of one write: the text, its Enter, and any retry Enter.
- The lock is the file `run/type-lock-<pane id>`, in the run directory of the project that owns the pane. It is created exclusively and holds the holder's pid and a stamp.
- The stamp is refreshed between steps (each tmux call). A waiter takes the lock over when the pid is dead, or when the stamp is 60 s old: twice the kit's 30 s tmux timeout, so a holder stuck in one slow call isn't taken over as it returns.
- It is re-entrant per call chain, not per process. In a command-line process the chain is the process, since its writes are synchronous. In the dashboard, which serves many requests at once, the hold is carried in `AsyncLocalStorage`, where every wait is async (a timer, never `Atomics.wait` or another blocking sleep), so one request waiting never freezes the server and a keys request never enters a hold `paneAnswer` has.
- Each writer reads the floor only after taking it, so no owner key lands between the check and the write.
- When the lock stays busy, a kit writer holds its line in `run/held/` after 10 s without it, and the keys route answers 503 after 2 s.
- `paneAnswer` releases it after its Enter and before it runs `pane answered`, so that command's own flush takes the lock afresh.

**Every writer.** Each takes the lock and, but for `paneAnswer`, waits for the floor; each has a test:
- the keys and paste routes;
- `typeNow`, under `typeInto`;
- `flushHeld` and `flushAllHeld`;
- `resendLostEnter`;
- `machine tell` and `enterLanded`;
- `paneAnswer`.

An older kit on the same machine takes no lock; until a project adopts this contract's release, its own writers don't take it, and its dashboard has no terminal tabs either.

## 12. Not logged

Keys and pastes are never logged, and never written to any file. The routes write no log line, owner answer or act. A refusal's reason may be printed to the dashboard's own output, but never a body, `data` or `paste`.

## 13. What this doesn't defend against

On a laptop, a program on the machine that drives a browser at the dashboard can type as the owner without forging anything. On a box, an agent that forges the gateway's signature. Agents are trusted not to do either.

## 14. The fake

`test/fixtures/term-fake.mjs` answers these routes from a scripted screen, with Node built-ins only, so the page's tests run without tmux. `startTermFake(opts)` starts it on `127.0.0.1`, port 0, and resolves to `{ url, port, token, set(patch), screen(which), typed(which), close() }`; it also exports `WHYS`, the five `why` values.

It enforces every check of §3 in §3's order, handles one post at a time per pane, keeps the last `seq` per `page` and `which`, and echoes typed bytes into its screen (a printable byte at the cursor, `\r` to the next row, `\x7f` erasing one). It doesn't verify the gateway's signature, take the lock or keep the floor.

| Option (and `set()` field) | Default | What it does |
|---|---|---|
| `cols`, `rows`, `lines` | 80, 24, `[]` | the supervisor's screen |
| `shell` | true | false: Shell is `gone` until `shell/open` |
| `supervisor` | `'live'` | `'gone'`: the supervisor isn't running |
| `pane` | `'%1'` | the supervisor's pane id; Shell's is `'%2'` |
| `bracketPaste` | false | true: a paste is recorded as `\x1b[200~…\x1b[201~` |
| `held` | `{ count: 0, oldest_ms: 0, prompt: 'readable' }` | the supervisor's `held` |
| `refuse` | null | one of the five `why`s: every route refuses for it |
| `gatewayView` | false | every `/api/term/*` answers as the gateway's View deny |
| `busy` | false | the supervisor's keys answer 503 |
| `history` | `[]` | the scrollback, oldest first |
| `sendMs` | 0 | how long one send takes |
| `serve` | null | `(req, res)` for any other path, so a page under test loads from the fake's own origin |
