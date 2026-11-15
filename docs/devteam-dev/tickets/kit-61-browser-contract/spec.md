# kit-61-browser-contract: spec

The `browser@1` contract: `docs/devteam/schema/browser.schema.json`, its fixtures in `test/fixtures/browser/`, the loopback fixture site `test/lib/sites.mjs`, and `test/browser-contract.test.mjs`, which holds all three to each other.

Feature `supervisor-browser`, stories SB-S1, SB-S2, SB-S3. Design: home's `project/designs/supervisors-can-use-a-browser-with-the-o.md` (Components 1 to 5, Contracts, Security). Kind `contract`, risk normal. No `depends_on`.

## Why

kit-63 (the egress guard), kit-64 (the command), kit-65 (the view page) build in parallel against this contract (D2), and kit-66, kit-67 and kit-68 test against it. So it fixes now, in one file each can read, every shape those tickets print, store or send, and it gives every later test one local site to browse, so no ticket in the feature reaches a real site. Nothing here runs a browser.

## Approaches

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | **One schema whose shapes stay inside the subset the kit's own checker reads** (`schemaErrors` in `devteam.mjs`: `type`, `enum`, `const`, `pattern`, `min/maxLength`, `minimum/maximum`, `min/maxItems`, `items`, `properties`, `required`, `additionalProperties`), one named shape per output under `$defs`, socket messages dispatched by `t` the way `log.schema.json` dispatches by `type` | kit-63/64/66/67 validate with the checker devteam.mjs already has: no new code, no dependency. No `$ref`, `oneOf` or `if`, so the masked-URL pattern is repeated in each URL field (the test proves every copy equal), and a few cross-field rules live in descriptions and in the test | **Chosen** |
| B | Full JSON Schema 2020-12 (`$ref`, `oneOf`, `if/then`) | Tidier, but the kit's checker silently ignores those keywords, so kit-64's own validation would pass anything; a real validator is an npm dependency the kit refuses | Rejected |
| C | Fixtures only, no schema (the fixtures are the contract) | Nothing a consumer can check its output against; "browser: 2 fails" has nothing to fail against | Rejected |

## What is provided

### 1. `docs/devteam/schema/browser.schema.json` (`browser@1`)

Top level: `$schema`, `$id: devteam/browser.schema.json`, `title`, a `description` (what the contract versions; that every shape here carries `browser: 1` or, for socket messages, its `t`; that a change other than a new optional field bumps `browser` and the file's `@` version; that every shape is checked with the kit's own subset), `x-masked-url` (the one masked-URL pattern, below), `x-masked-fields` (the path of every field that carries it, e.g. `shapes.tabs.tabs[].url`, `shapes.snapshot.nodes[].href`, `shapes.wait.reopened[]`), `x-unmasked-fields` (the one URL field that doesn't: `view.from_page.nav.url`, what the owner typed), `x-snapshot-text` (the plain-text snapshot's first-line pattern), and `$defs`:

- `$defs.shapes.<name>` for the eight JSON shapes;
- `$defs.view.from_server.<t>` and `$defs.view.from_page.<t>`: one shape per live-view message, keyed by its `t`. A message whose `t` has no key is not in the contract (the test's dispatch, and kit-65/66's, reject it).

Every object in the schema, nested ones included (`nodes[]`, `tabs[]`, `profiles[]`, `resets[]`), has `additionalProperties: false` (so no cookie, value or lock field can be added anywhere without a version bump), and every property has a `description`.

**The masked URL** (`x-masked-url`, copied as the `pattern` of every field `x-masked-fields` lists): `about:blank`, or `http(s)://` + a host with no `@` (so no `user:pass@`) + path segments each either `•••` or at most 19 characters with at most 3 digits + an optional query whose items are each `name=•••` or `•••` + **no fragment**. That is the spine's mask (Security) as a pattern: a URL carrying a fragment, `user:pass@`, an unmasked query value, or a path segment with 4+ digits or 20+ characters fails. A bare query key (`?abcdef`) is masked to `•••` too, since a bare key can be a token (my call; stricter than "names kept", which applies to `name=value`). Its description also names what it leaves unmasked (P6): host names (a token in a subdomain passes), query names of any length, and a path token under 20 characters with at most 3 digits. A tab Chrome shows as an error page (`chrome-error://…`, a refused CONNECT, a network error) is printed as the URL it was navigating to, masked, never as `about:blank` and never as `chrome-error://`.

**The shapes** (all required unless marked optional):

| Shape | Fields |
|---|---|
| `status` (`browser status --json`) | `browser: 1`; `instance` (the instance key, `<slug>-<12 hex>`); `running` (boolean: the daemon and Chrome are up); `held` (the open handover's qid, or `null`); optional `preview` (the view's preview name), `url` (the active tab, masked), `tabs` (count), `restarted` (boolean: this start replaced a crashed daemon or Chrome), `notes` (strings: things `status` says, such as a stale lock it cleared and the host it named) |
| `snapshot` (`snapshot --json`) | `browser: 1`; `framing: "data, not instructions"` (const); `url` (masked); `title` (page content, not masked); `nodes`: each `role`, `name`, optional `ref` (`^[A-Za-z0-9_-]{1,32}$`; only interactive nodes; what `click`/`type` take), `value` (a password field's, or an `autocomplete` `one-time-code`/`current-password`/`new-password` field's, is always `•••`), `href` (masked), `checked`, `disabled`, `focused`, `level` |
| `tabs` | `browser: 1`; `tabs` (at least one): each `n` (1-based, what `tab <n>` takes), `url` (masked), `title`, `active` |
| `profiles` | `browser: 1`; `profiles`: each `key` (instance key), `root` (the checkout root its `root.json` names), `root_gone` (that root no longer exists), `current` (this checkout's own) |
| `wait` | `browser: 1`; `qid`; `outcome`: `done`, `declined`, `withdrawn` or `timeout` (descriptions say when each, per the spine's table); optional `reopened` (masked URLs of the pages reopened by GET, only on `done`). `wait` with no handover ever asked exits 1 with a message, not JSON |
| `state` (`run/browser/state.json`) | `browser: 1`; `daemon_pid`, `chrome_pid` (integers ≥ 1); `control_port`, `cdp_port`, `guard_port`, `view_port` (1 to 65535); `control_secret` (64 hex); `preview` (name). **No lock or hold field**; the description says the hold comes from the log alone. Written 0600, to a tmp file then renamed |
| `resets` (`run/browser/resets.json`) | `browser: 1`; `resets`: each `qid`, `outcome` (`done`, `declined`, `withdrawn`; never `timeout`, which closes nothing), `reset` (boolean; `true` exactly when the outcome is not `done`: described, and checked by the test on the fixture), `at` (the log's timestamp form), optional `reopened` (on `done` only: the masked URLs the daemon reopened by GET; this is what "recorded in resets.json" means for kit-67). Written only by the daemon, to a tmp file then renamed |
| `refusal` (the egress guard's answer) | `browser: 1`; `rule`: `special-purpose`, `own-interface`, `own-name`, `gateway` (each answered 403) or `not-a-proxy-request` (answered 400); `why` (plain words); optional `host` (the refused host as asked; always present on a 403), `address` (the address it resolved to), `range` (an enum: the refused range the address fell in, the most specific that holds it) |

**The refusal page.** The guard answers `text/html; charset=utf-8`: a plain page (R2, the spine's "plain error page") whose heading and text are `why` in words ("The supervisor's browser can't open 127.0.0.1: it is this machine's own address."), and which carries the `refusal` object as JSON in `<script type="application/json" id="devteam-refusal">…</script>`, with every `<` in the JSON written as the six characters `\u003c` (so no `</script>` can close it early), and `why` HTML-escaped where the page shows it. That element is the contract: kit-64 reads it from the page (or the response body) to print the host and rule; kit-63 parses it from the body. The fixture is `refusal.html`; the test extracts the element, validates it against `shapes.refusal`, and checks the visible text contains `why`.

**Rule order** (what a destination that several rules refuse is reported as): `own-name`, then `gateway` (both on the name, before resolving), then `own-interface`, then `special-purpose` (on the resolved address). So a machine's own public address that also sits in a refused range (kit-63's 203.0.113.7) reports `own-interface`.

**The refused ranges**, named in `refusal`'s descriptions and enumerated in `range`: the spine's list (127.0.0.0/8, 0.0.0.0/8, ::/128, ::1/128, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10, 192.0.0.0/24, 198.18.0.0/15, 224.0.0.0/4, fc00::/7, fe80::/10, 64:ff9b::/96, ::ffff:0:0/96) plus the rest of the IANA IPv4 and IPv6 special-purpose registries (192.0.2.0/24, 192.31.196.0/24, 192.52.193.0/24, 192.88.99.0/24, 192.175.48.0/24, 198.51.100.0/24, 203.0.113.0/24, 240.0.0.0/4, 255.255.255.255/32; 64:ff9b:1::/48, 100::/64, 2001::/23, 2001::/32, 2001:db8::/32, 2002::/16, 2620:4f:8000::/48, 3fff::/20, 5f00::/16, ff00::/8) and, since the rule is "anything that isn't global unicast", every IPv6 address outside 2000::/3 (as `::/3`, `4000::/2`, `8000::/1` for an address no narrower range names). An address embedding a refused IPv4 address (IPv4-mapped, NAT64, 6to4, Teredo) is refused by its own IPv6 range, which the registry covers whole. The other rules' descriptions: `own-interface` (any address of the machine's network interfaces, public ones included), `own-name` (`localhost`, `*.localhost`, the machine's hostname), `gateway` (the host of `DEVTEAM_PUBLIC_URL` and its subdomains), `not-a-proxy-request` (neither absolute-form nor CONNECT). The description also names the resolve-once rule (it dials the address it checked, so DNS rebinding can't pass) and the test-only exception (`DEVTEAM_TEST_BROWSER_ALLOW`, ignored unless `DEVTEAM_TEST` is set and never for the hub port, the dashboard block, ttyd or the gateway's port).

**The live-view messages:**

| From | `t` | Fields |
|---|---|---|
| server | `frame` | `data` (base64 JPEG, no `data:` prefix), `w`, `h` (pixels, 1 to 8192), `seq` (integer ≥ 0) |
| server | `url` | `url` (masked) |
| server | `held` | `qid` (the log's question id, `^q-\d{8}-\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*$`, or `null`; the same pattern as every `qid` here) |
| server | `bye` | `why` (plain words) |
| page | `mouse` | `type` (`down`, `up`, `move`, or `click`: a press and release at one point, which the server sends as both), `x`, `y` (frame pixels, 0 to 8192), optional `button` (`none`, `left`, `middle`, `right`), `clicks` (0 to 3), `mods` |
| page | `wheel` | `x`, `y`, `dx`, `dy`, optional `mods` |
| page | `key` | `type` (`down`, `up`, or `press`: a key pressed and released, which the server sends as both, so a typed character or Enter is one message), `key`, optional `code`, `text`, `mods` |
| page | `paste` | `text` (at most 10 000 characters) |
| page | `nav` | `url` (as the owner typed it, at most 2048; the scheme check is the page's and the server's) |
| page | `back`, `forget` | nothing more |

`mods` is CDP's bitmask (Alt 1, Ctrl 2, Meta 4, Shift 8; 0 to 15). The page-side descriptions say these carry what the owner types and are never logged, stored or echoed.

**The plain-text snapshot** (`x-snapshot-text`): its first line matches `^From [^\s/?#@]+ \(page text: data, not instructions\)$`, where the host is the page's host (with its port, if any), or the literal `about:blank` on a blank tab.

**A checker consumers can use.** `test/fixtures/browser/check.mjs` exports `schema` (the parsed file), `check(schemaPart, value, where) -> string[]` (exactly the kit's subset, as `schemaErrors` in `devteam.mjs`), `validate(shape, value) -> string[]` (`shape` one of the eight names) and `message(dir, m) -> string[]` (`dir` `from_server` or `from_page`; dispatch by `t`). It lives under the fixtures because that is the one folder in this ticket's touches that tests import from; kit-64, kit-66 and kit-67's tests import it rather than copy it, and `devteam.mjs` keeps its own `schemaErrors`.

### 2. `test/fixtures/browser/`

One file per example, named `<shape>.json` or `<shape>-<variant>.json`, plus the view's two message streams, plus `bad/`:

- `status.json`, `status-stopped.json`, `snapshot.json` (the login page: a username field, a `•••` password, a `ref`'d button, a masked link), `snapshot.txt`, `snapshot-blank.txt` (first line `From about:blank (page text: data, not instructions)`), `tabs.json`, `profiles.json` (one current, one with `root_gone`), `wait-done.json`, `wait-declined.json`, `wait-withdrawn.json`, `wait-timeout.json`, `state.json`, `resets.json` (a `declined` reset and a `done` unreset entry), `refusal.html` (a 403 page, rule `special-purpose`, range 127.0.0.0/8), `refusal-not-a-proxy-request.html`;
- `view-from-server.json`: an array replayable by kit-65's fake server: two frames of different sizes (real JPEGs, made once with ImageMagick and committed; the test reads each JPEG's SOF size and asserts it equals the frame's `w` and `h`), `url`, `held` with a qid, `held` null, `bye`;
- `view-from-page.json`: an array with every page message type, and every `mouse` and `key` `type`, at least once (mouse down/up/move/click, wheel, key down/up/press with text, paste, nav, back, forget);
- `bad/`: `status-browser-2.json`, `snapshot-no-framing.json`, `tabs-fragment.json`, `view-from-server-unknown-type.json`, `view-from-page-unknown-type.json`, `snapshot-text-no-framing.txt`, plus `state-lock.json`, `tabs-userinfo.json`, `snapshot-query-value.json`, `resets-timeout.json`. Each differs from a good fixture in the one thing its name says.

Hosts in fixtures are `*.example` names or loopback; no fixture holds a real token, cookie or account; `state.json`'s `control_secret` is 64 zeros, visibly fake.

### 3. `test/lib/sites.mjs`

`startSites({ port = 0 } = {})` serves on `127.0.0.1` (port 0 = a random free one) and resolves to `{ port, origin, username, password, code, posts(), events(), sessions(), close() }`. `password` and `code` are random per start and shaped so a grep for them can't match by chance (kit-67, kit-68): `password` is `pw-` plus 20 lowercase base32 characters; `code` is 10 characters from `A-Z` and `2-9`, starting with a letter (no run of digits, nothing hex-like, nothing a timestamp or pid contains). `sessions()` lists the session cookie values issued (`s-` plus 32 lowercase base32), so a test can grep that no value leaked. Node built-ins only, runs on Node 18. Run directly (`node test/lib/sites.mjs [port]`) it starts one and prints `{ port, origin, username, password, code }` as one JSON line, then one `{"session": "<value>"}` line on stdout each time it issues a session cookie (so whoever starts it keeps its stdout in a pipe it reads, never in tmux or `run/`, or its own grep finds the value), for a test driving a shell (kit-68; starting it in process with `startSites` works as well). Request bodies are capped at 64 KB.

| Route | What |
|---|---|
| `GET /` | an index linking every page |
| `GET /login[?variant=page]` | a form `POST /login`: `username` (no `autocomplete`), `password` (`type=password`), a `remember` checkbox, a hidden `variant` |
| `POST /login` | right name and password: sets `pending` (random, session-only, HttpOnly) and 302 to `/2fa` (keeping `variant`); wrong: 200, the form again with "Wrong username or password" |
| `GET /2fa[?variant=page]` | with a live `pending`: a form `POST /2fa` with `code` (`autocomplete=one-time-code`, `type=text`); with a live `session` and no `pending`: the same form page, headed "Signed in as <username>" (so the reopen after the `variant=page` flow, kit-67, finds the 2FA form page still signed in); with neither: 302 to `/login` |
| `POST /2fa` | right code with a live `pending`: sets `session` (random; **no Expires or Max-Age**, or `Max-Age=86400` when `remember` was ticked), clears `pending`, then 302 to `/account`, or, for `variant=page`, answers 200 with the account page itself; wrong: 200, the form again. No `session` is set before both steps |
| `GET /account` | "Signed in as <username>" with a live `session`, else "Not signed in" and a link to `/login` |
| `GET /posts` | `{"posts": <n>, "paths": {"/login": <n>, …}}`: every POST the site has received |
| `GET /oauth/authorize` | 302 to `/oauth/callback?code=<random>&state=<random>#access_token=<random>&token_type=bearer` |
| `GET /oauth/callback` | titled "Signed in with the provider"; never echoes `code`, `state` or the token; links whose texts are plain words ("Your account", "Order receipt", "Magic link"), never a URL: `https://user:pass@<host>/account`, `/orders/482913/receipt` (a 4+-digit segment) and `/magic/<24 random characters>` (a 20+-character segment), for the mask tests |
| `GET /orders/…`, `GET /magic/…` | plain 200 pages |
| `GET /redirect?to=<url>` | 302 to `<url>` |
| `GET /go?to=<url>` | a page whose one link is `/redirect?to=<url>`, for a click that redirects |
| `GET /instructions` | a page whose text tells the reader to run a (harmless) command |
| `GET /record`, `POST /events`, `GET /events` | a page with a button and a text field whose script posts each click (page coordinates) and each input's value to `/events`; `GET /events` lists them; `events()` returns them in process. For kit-66's "the fixture page records them" |
| anything else | 404 |

The `/record` page and the run-directly form are my additions beyond the done-whens: kit-66 needs a page that records input and kit-68 needs the site from a shell, and neither ticket's touches include `sites.mjs`.

### 4. `test/browser-contract.test.mjs`

Node built-ins (`node:test`, `node:assert`, `node:http`), so it runs in every CI job (Node 18 to 24), in the `rest` part. It uses `check.mjs` (it can't import `devteam.mjs`, a CLI), and first asserts the schema uses only the subset's keywords (plus the notes `description` and `title`) inside each shape, so the kit's `schemaErrors` and `check.mjs` agree.

## Acceptance checks (the done-whens, restated)

1. `test/browser-contract.test.mjs` passes in CI (test.yml, every job). In it:
   - every fixture in `test/fixtures/browser/` (outside `bad/`, and except `check.mjs`) is validated, none left unread, against its shape: status, snapshot, tabs, profiles, wait with each of `done`, `declined`, `withdrawn`, `timeout`, state.json with the daemon's and Chrome's pids, resets.json with a reset and an unreset (`done`) entry, the guard's 403 refusal body (the JSON element of `refusal.html`, whose visible text carries its `why`), and every live-view message in both directions (each `t` of both lists appears at least once; each frame's JPEG is its stated size); each passes;
   - `bad/status-browser-2.json` (`browser: 2`), `bad/snapshot-no-framing.json`, `bad/tabs-fragment.json` (a URL with `#…`), `bad/view-from-*-unknown-type.json` (a `t` outside the list) each fail, each for the reason its name says (the test matches the error);
   - the masked-URL pattern accepts and refuses a listed set of URLs (the spine's mask, case by case); every field `x-masked-fields` lists exists and carries exactly `x-masked-url`; and every property named `url`, `href` or `reopened` in the schema is listed there or in `x-unmasked-fields` (only `nav.url`), so a new URL field can't go unmasked unnoticed.
2. The same test starts `test/lib/sites.mjs` on a random loopback port and gets, over plain HTTP with cookies handled by hand: the login form with a password field; the 2FA POST form with an `autocomplete=one-time-code` field; a `session` cookie only after both steps (none after the first), with no Expires or Max-Age; the remembered variant's cookie with `Max-Age=86400`; the `variant=page` 2FA POST answering 200 with the account page, not a redirect; `GET /posts` counting every POST; `/oauth/authorize` answering 302 to `?code=…#access_token=…`; the callback page's `https://user:pass@host/…` link; `/redirect?to=<url>` answering 302 to that URL; and `/instructions` whose text tells the reader to run a command.
3. The schema's `refusal` descriptions name each rule and each of the spine's refused ranges (the test checks each string is there), and the `state` shape has no lock field (no property named like `lock`, `hold` or `held`, and `additionalProperties: false`).

## Contracts

- **Provides:** `docs/devteam/schema/browser.schema.json@1`, the fixtures, and `test/lib/sites.mjs`. The fake the contract stage asks for is the fixtures plus the site: consumers build against them.
- **Consumes:** nothing.

## Edge cases

- **The 403 on CONNECT.** For an `https:` page Chrome doesn't show a proxy's CONNECT answer body; it shows its own tunnel error. The body is still the refusal page (kit-63 tests it on GET and CONNECT); how `open` and the view report it on an `https:` page is kit-64's and kit-66's (the tab's URL is still the one it was opening, above). Noted in the description.
- **A URL the mask can't express.** `chrome-error://…` prints as the URL being opened (above); `data:`, `blob:` and other schemes never print: the pattern admits only `about:blank` and `http(s)`. A consumer that meets one prints a message instead of a URL, or asks for `browser@2`.
- **`chrome_pid` during a restart.** Integer only: the daemon rewrites state once the new Chrome is up; a stale pid is harmless because kit-64's kill needs the command-line proof.
- **Coordinates.** `x`, `y` are frame pixels (the `w`×`h` of the last frame); the page scales from its canvas (kit-65).
- **A key event's text carries a password.** The schema bounds and types it; never logging it is kit-66's, stated in the description.
- **Refusing all of 6to4, Teredo and NAT64**, not only their embedded refused forms, is stricter than the spine's "embedded forms of these", and follows from refusing the registry whole. Few outside sites need them.
- **Ports.** The site takes a random port (port 0), outside the kit's port blocks (`test/lib/ports.mjs`), so it never meets 4320 to 4345, 7681 or 8080.

## Out of scope

Anything that runs Chrome; the guard, daemon, verbs, view and handover themselves (kit-63 to kit-67); a schema change to the log; `devteam.mjs`; any doc.

## Rulings

None yet.
