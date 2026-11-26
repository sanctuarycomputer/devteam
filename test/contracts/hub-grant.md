# Hub grants: hub-grant@1

Contract `hub-grant@1`: how a computer, or an app on it, signs in to a box's hub and what that sign-in (a **grant**) may then do. Provided by the gateway (`cloud/gateway.mjs`: the authorization server, the bearer routes, the client-metadata fetch, the grant mark) and by the dashboards (`devteam.mjs`: recording the mark). Used by `devteam login`, `logout` and `whoami --hub` (`devteam.mjs`), the hub's "Your computers and apps" (`hub.html`), local MCP clients that do OAuth themselves, and the MCP goal's server, which plugs in behind §13. `test/hub-grant-contract.test.mjs` holds this document, its fixtures (`test/fixtures/hub-grant/`, §16) and its fake (`test/lib/hub-grant-fake.mjs`, §16) to one another.

Sizes are bytes of UTF-8. A KB is 1024 bytes. A day is 86400 s. `<box>` is the gateway's own host (the host of its public URL, `PUB`, port included when it has one), so `https://<box>` is its origin.

## 1. Providers, consumers and versioning

Version 1. The authorization server metadata (§3) says nothing of the version; this document does. Additive changes keep it: a new metadata field, a new field in a JSON answer or a grant row, a new fixture, a new reason an old grant ended, a newer MCP protocol version in §13's list. A reader ignores keys it doesn't know. Anything else bumps it to `hub-grant@2`: a scope added, removed or given another route, a route added to a scope, a changed lifetime, a changed header form, a changed label rule, a loosened fetch rule, a metadata-document client given more than `mcp`.

## 2. Audiences and hosts

There are two audiences (RFC 8707 resource indicators). Each access token is bound to exactly one.

- **`https://<box>/`**: the gateway's own API. It covers requests to the box's own host `<box>` and to a project's host `<project>.<box>` (project-hosts@1), and nothing else: never the terminal's host, never a preview's host, never a published page.
- **`https://<box>/mcp`**: the MCP server, `POST /mcp` on `<box>` alone.

The two strings are compared exactly, as written above, with the trailing `/` on the first and none on the second. Any other `resource` is refused (`invalid_target`).

## 3. Endpoints

All on `<box>`, served by the gateway. The issuer is `https://<box>` (no trailing `/`).

- **`GET /.well-known/oauth-authorization-server`** (RFC 8414), public, JSON, exactly these fields: `issuer` `https://<box>`; `authorization_endpoint` `https://<box>/auth/grant/authorize`; `token_endpoint` `https://<box>/auth/grant/token`; `revocation_endpoint` `https://<box>/auth/grant/revoke`; `response_types_supported` `["code"]`; `grant_types_supported` `["authorization_code", "refresh_token"]`; `code_challenge_methods_supported` `["S256"]`; `token_endpoint_auth_methods_supported` `["none"]`; `revocation_endpoint_auth_methods_supported` `["none"]`; `scopes_supported` `["hub:read", "threads:write", "mcp", "bridge", "owner:act"]`; `authorization_response_iss_parameter_supported: true`; `client_id_metadata_document_supported: true`. There is no `registration_endpoint`: dynamic client registration is not offered.
- **`GET /.well-known/oauth-protected-resource/mcp`** (RFC 9728), public, JSON, exactly: `resource` `https://<box>/mcp`; `authorization_servers` `["https://<box>"]`; `scopes_supported` `["mcp"]`; `bearer_methods_supported` `["header"]`.
- **`GET /auth/grant/authorize`**: the code flow (§4, §5), with the person's passkey session.
- **`POST /auth/grant/consent/options`** and **`POST /auth/grant/consent`**: the consent page's passkey challenge and its Allow or Deny (§4, "The consent").
- **`POST /auth/grant/token`**: `application/x-www-form-urlencoded`, no client secret (§9).
- **`POST /auth/grant/revoke`**: two forms (§9): RFC 7009 with a token in a form body, or the hub's with a JSON `{ "id" }` and a session.
- **`GET /auth/grant/list`**: the grants a session may see (§14), JSON, with a session only (never a token).

Every other `/auth/grant/…` path is 404. The metadata documents and their answers are fixtures (`as-metadata.json`, `prm-mcp.json`, for `<box>` = `box.example.dev`).

**The guards each new route runs**, before anything else it does. These replace, for these routes alone, the gateway's rule that a write carries the name's own `Origin` and its View refusal of writes; every other route keeps both.

| Route | Session (cookie) | `Origin` | A View person | `Authorization` |
|---|---|---|---|---|
| both `/.well-known/…` | not read | not read | allowed | ignored |
| `GET /auth/grant/authorize` | required (signed out: sign in first) | not read (a navigation) | allowed | ignored |
| `POST /auth/grant/consent/options`, `POST /auth/grant/consent` | required, the same session as the consent | must be `https://<box>` | allowed | ignored |
| `POST /auth/grant/token` | never read | absent, or `https://<box>`; any other is 403 | n/a | ignored |
| `POST /auth/grant/revoke`, form | never read | absent, or `https://<box>`; any other is 403 | n/a | ignored |
| `POST /auth/grant/revoke`, JSON | required | must be `https://<box>` | allowed (their own grants) | ignored |
| `GET /auth/grant/list` | required | not read | allowed | ignored |
| §7's routes, with `Authorization` | a cookie too is 400 | absent, or the host's own origin (`https://<box>` or the project's); any other is 403 | by scope (§10), never by the session rule | the token (§8) |

## 4. Authorize

`GET /auth/grant/authorize` with these query parameters. A parameter it doesn't know is ignored (RFC 6749 §3.1). A known one may come at most once, `resource` excepted:

- `response_type=code`, exactly;
- `client_id`: `devteam` (the kit's own client) or an `https` URL (a Client ID Metadata Document, §6);
- `redirect_uri`: one the client may use (below);
- `code_challenge`: 43 characters of `A-Z a-z 0-9 - _` (a base64url SHA-256), and `code_challenge_method=S256`, exactly; `plain` or a missing method is refused;
- `state`: 1 to 512 characters, returned unchanged; optional;
- `resource`: one or two, each one of §2's audiences, no audience twice; at least one is required. A metadata-document client may name only `https://<box>/mcp`;
- `scope`: space-separated names from §7, each at most once. Absent, it is `mcp` when `https://<box>/mcp` is asked for, plus `hub:read` when `https://<box>/` is: never `threads:write`, `bridge` or `owner:act`, which are asked for by name. A metadata-document client may ask only for `mcp`;
- `label`: the computer's label (§5); optional for a metadata-document client, required for `devteam`.

The whole query is at most 8 KB; a longer one gets the error page.

**Order of the checks.**

0. **No live session**: the person is sent to sign in, and back only to a same-origin path that starts `/auth/grant/authorize?`. Nothing else is read first, so a signed-out request never makes the box fetch anything (§6).

These come next, in this order, and are never redirected: each is answered with an error page on the gateway (400, HTML, words only), never a redirect (RFC 6749 §4.1.2.1):

1. a missing or repeated `client_id`, or one whose metadata can't be read (§6, with the fixed reason);
2. a missing or repeated `redirect_uri`, or one the client may not use;
3. a repeated `label`, a bad one (§5, saying which rule it breaks), or none from `devteam`;
4. a person who already has 20 live grants (§10). The cap is checked again when the code is traded (§9), since several consent pages may be open at once.

After that, every other error goes back to the redirect as `error=<code>`, `error_description`, `state` (when it was good) and `iss=https://<box>`:

- `invalid_request`: a parameter that isn't valid UTF-8 or is repeated, a challenge or method wrong, a bad `state`, no `resource`;
- `unsupported_response_type`;
- `invalid_target`: a `resource` that isn't one of §2's, the same one twice, or `https://<box>/` from a metadata-document client;
- `invalid_scope`: an unknown or repeated scope, one whose audience wasn't asked for, or anything but `mcp` from a metadata-document client;
- `access_denied`: the person pressed Deny, or asked by name for `bridge` or `owner:act` without being the owner.

**What a grant may hold.** `threads:write` asked for by a person at level View is left out, never refused: the consent page says it isn't included, and the token's `scope` says what was granted (RFC 6749 §3.3). So a View person's `devteam login`, which asks for `hub:read threads:write mcp`, gets `hub:read mcp`.

**The consent.** With the checks passed, the gateway shows the consent page and keeps a consent record in memory: a random id (32 bytes, base64url), the session, the person, and every parameter it will grant (client, redirect, resources, scopes, label, challenge, state). It lives 10 minutes and works once.

- `POST /auth/grant/consent/options` with `{ "consent" }` answers a WebAuthn challenge for that consent alone, for the person's own passkeys, user verification required.
- `POST /auth/grant/consent` with `{ "consent", "decision": "allow" | "deny", "assertion" }` ends the consent record whatever happens. Allow needs a fresh assertion: of that challenge, from a passkey of the consent's person, made within 2 minutes; the cookie alone never allows. It answers `{ "redirect": "<url>" }` and the page navigates there: with the code on Allow, with `error=access_denied` on Deny.
- An unknown, used, expired or another session's consent, or an assertion that fails, is refused (400, words) and redirects nowhere. Nothing in the request can change what the consent record grants.

The consent page names the client, the computer's label, the redirect's host (with a warning when the client's only redirects are loopback: any program on that computer can claim the name), and each scope in plain words; it names `bridge` and `owner:act` only when they are asked for. For a metadata-document client it shows the host of its `client_id` beside the name it gives itself, and never draws it as the kit's own client, whatever its `client_name` says.

**Redirects.**

- For `devteam`: `http://127.0.0.1:<port>/<path>` or `http://localhost:<port>/<path>`, any port from 1 to 65535 written out, the host in lower case exactly as written here, any path, a query allowed, no fragment, no user info. Nothing else: not `https`, not `[::1]`, not `LOCALHOST`, not another loopback address.
- For a metadata-document client: only a URI its document lists (§6), compared as exact strings, case included. A listed loopback URI (`http://127.0.0.1…`, `http://localhost…` or `http://[::1]…`, with or without a port) matches a requested URI with the same host, path and query on any port or none (RFC 8252 §7.3): the port is the only part ignored.
- Never `javascript:`, `data:`, `file:` or any scheme but `http` (loopback only) and `https`; never a fragment.

**The answer.** Allowed, the gateway sends the person to the redirect with `code`, `state` (when given) and `iss=https://<box>` (RFC 9207). A code is 32 random bytes in base64url, lives 60 seconds and works once. Codes are kept in the gateway's memory only.

## 5. The label

The computer's label is how a grant names the computer: the authorize parameter `label`.

- It is 1 to 40 bytes of UTF-8, measured decoded: never as encoded in a URL or a header. A label of 40 bytes whose percent-encoding is far longer is good.
- It holds no character of Unicode general categories Cc, Cf, Zl or Zp (controls; format characters, the bidi overrides and isolates among them; line and paragraph separators), and no `[`, `]`, `;` or `%`.
- It neither starts nor ends with a space (any character of category Zs), so it is never blank.
- Its percent-decoding must be valid UTF-8 (`+` is a space, as in any query).
- A bad one is refused at authorize with words, never cut or cleaned.
- `devteam login` sends the computer's hostname by default (`--label` sets it), and checks either against this rule before it opens the browser.
- **A client that sends none** (a metadata-document client): its document's `client_name` is cut to the rule. Every character the rule forbids is removed, the rest is cut to its longest start of at most 40 bytes on a character boundary (never inside a multi-byte character), and spaces (Zs) at either end are trimmed. When that leaves nothing, or there is no `client_name`, the label is the words `an app`.
- The gateway stores the label on the grant (§14) and puts it in the grant mark (§11).

Fixture: `labels.json`.

## 6. Clients, and the client-metadata fetch

**The kit's own client** is `client_id=devteam`, known to the gateway's code, named "devteam" on the consent page, with §4's loopback redirects.

**Any other client** names itself with a Client ID Metadata Document: its `client_id` is an `https` URL, and the JSON document at that URL names it. Such a client gets only the `mcp` scope for `https://<box>/mcp` in this version (§4). This is the gateway's first way out of the box, so the fetch is narrow:

- it happens only for a request with a live session (§4, check 0);
- the URL is `https`, has a path other than `/`, and has no user info, no query and no fragment. Its path holds no dot segment, no `%2e`, no encoded slash or backslash and no doubled slash (the same raw-path rule as §7). A port is allowed;
- the host is resolved once. Every address it resolves to must be public unicast, or the fetch is refused; the connection goes to the address that was checked, with no second lookup, and TLS is verified for the URL's host name (the certificate and SNI are the host's, never the address's). Refused: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4` (with `255.255.255.255`); and for IPv6 anything outside `2000::/3`, plus `::`, `::1`, `::ffff:0:0/96` (IPv4-mapped, whatever the address inside), `64:ff9b::/96`, `100::/64`, `2001::/23`, `2001:db8::/32`, `3fff::/20`, `2002::/16`, `fc00::/7`, `fe80::/10`, `fec0::/10` and `ff00::/8`;
- no redirects: a `3xx` is a failure, never followed;
- 5 seconds for the whole fetch, and at most 5 KB (5120 bytes) of body, counted as it arrives: past 5120 the connection is dropped;
- a `200` only;
- the body is one JSON object with `client_id` equal to the URL exactly and `redirect_uris` a list of 1 to 10 strings, each `https` or loopback (`http://127.0.0.1`, `http://localhost` or `http://[::1]`, with or without a port, then a path), none with a fragment or user info; `client_name`, when present, is a string of at most 200 bytes. Other fields (`client_uri`, `grant_types`, `token_endpoint_auth_method`, …) are ignored;
- at most one fetch of a URL at a time (a second request waits for the first) and at most 4 fetches at once in all (beyond that, the fixed reason);
- a good document is cached for an hour, a failure for 60 seconds, by URL;
- any failure shows one fixed reason, "couldn't read this app's details", on the gateway's error page, never what came back, and nothing is redirected.

Fixtures: `metadata/*.json` (the documents), `metadata.json` (each case's URL, answer and verdict), `addresses.json`.

## 7. Scopes, and the routes each opens

| Scope | It lets the computer | Audience | Who may hold it |
|---|---|---|---|
| `hub:read` | read the hub as the person | `https://<box>/` | anyone |
| `threads:write` | post a turn, with files, to a project's thread, as the person, marked with the grant | `https://<box>/` | a person at level Full |
| `mcp` | reach the MCP server as the person | `https://<box>/mcp` | anyone |
| `bridge` | hold the bridge's connection (a later version) | `https://<box>/` | the owner |
| `owner:act` | have its turns count as the owner's own words | either | the owner |

**The routes.** A token opens exactly these, by exact method and exact path (the query string is not part of the path), on exactly the host named, and nothing else:

| Scope | Method and path | Host |
|---|---|---|
| `hub:read` | `GET /box.json` | `<box>` |
| `hub:read` | `GET /instances.json` | `<box>` |
| `hub:read` | `GET /memory.json` | `<box>` |
| `hub:read` | `GET /api/data` | `<project>.<box>` |
| `hub:read` | `GET /api/threads` | `<project>.<box>` |
| `threads:write` | `POST /api/thread-new` | `<project>.<box>` |
| `threads:write` | `POST /api/thread-say` | `<project>.<box>` |
| `threads:write` | `POST /upload` | `<project>.<box>` |
| `mcp` | `POST /mcp` | `<box>` |

- `threads:write` opens a dashboard's `thread-new` and `thread-say` and their file uploads, and never the hub's operator posts: `/operator/…` on `<box>` (reads and posts) and `POST /upload` on `<box>` (the operator threads' files) stay cookie-only.
- `owner:act` opens no route in this version. It is only the mark's bit (`owner-act=1`, §11).
- `bridge` opens no route in this version; the `/bridge` socket comes with the version that adds it.
- No signed press is reachable with a token, whatever its scopes: `/api/pane-answer`, `/api/owner-setting`, the terminal's `/api/term/…` (its open and keys), the hub's `/operator/…` posts, every other `/api/<action>` a dashboard takes, `/auth/…` (§3's routes read no token), `/push/…`, `/public…`, `/w/…`, `/dev/…`, a preview, a published page and the terminal's host. No signature's domain string changes.
- `/api/data` and `/api/threads` answer what the person's session would (the same `x-devteam-person` and `x-devteam-level`).

**Paths are judged raw, before matching.** The raw path (the request target up to `?`) is refused with 400 when it holds a dot segment (`.` or `..` between slashes or at the end), `%2e` or `%2E` anywhere, an encoded slash (`%2f`, `%2F`) or backslash (`%5c`, `%5C`, `\`), or a doubled slash (`//`). Only then is it matched, exactly, against the table. So a dashboard's own Origin, which the gateway asserts on `thread-new` and `thread-say` (§8), never reaches another owner action.

**Uploads.** On a box a project's files go to the gateway's own `POST /upload` on the project's host. A `threads:write` token passes that route's Origin rule for that route alone (§3's guards: `Origin` absent or the project's own). A token's request to any route not in the table is refused (§8), so no other route's Origin rule is ever met by a token.

Fixtures: `routes.json` (requests, with the scope and audience each needs, or refused) and `paths.json`.

## 8. Bearer requests at the gateway

A request is a **bearer request** when it carries an `Authorization` header on the box's host or a project's host, on a route other than §3's (which ignore it). Without one, every route answers as it does today with the cookie, except `/mcp`, which takes no cookie (below). On a preview's host and the terminal's host `Authorization` is never read as a token: a token opens nothing there, and a preview's own app may use the header for its own sign-in, so it passes to a preview as it does today, with one exception: a `Bearer` value that is one of this gateway's tokens (its hash matches an access or refresh hash a grant's record holds, §14, live or ended) is never forwarded anywhere; on a preview's or the terminal's host every `Authorization` header is checked, the scheme's case ignored; such a request is refused (400, "a devteam token is never sent to a preview") on the terminal's host, and on a preview's host when the request has a live session; without a session the next paragraph decides (401 for a bad or ended token, 404 for a good one), so the answer never depends on the label and the token is never forwarded either way. So a preview that takes a project's name while that project is not listed never sees the owner's token.

Which side a host falls on: `<box>` is the box's host; the terminal's host is the terminal's; a `<label>.<box>` is a preview's host when, at that request, it is the name of a preview the gateway serves, and otherwise a project's host (a name nothing lists, or a name two projects share, is a project's host and answers as today). The label is looked up only after a live session or a good token. Before that, every `<label>.<box>` is answered alike: a request with neither a session nor `Authorization` gets today's signed-out page, and a bearer request's token is read first, as on a project's host, so any bad token is 401 on every label alike. After a good token the label is looked up: a listed project's host is forwarded to its dashboard, a name two projects share answers as today, and anything else is 404, never forwarded. So no answer before a session or a good token tells one label from another. The class decided for a request is the one it is forwarded by: the label is looked up once per request, and a request classed a project's host is never forwarded to a preview. A published page's path is on its own host's side.

- A token comes only in one `Authorization: Bearer <token>` header (the scheme's case ignored, one space). Two `Authorization` headers, another scheme, or a token in the query (`access_token`) or a form body is refused (400).
- A request with both the passkey cookie and a token is refused (400): a request is a session's or a grant's, never both.
- A token that is unknown, expired, of a dead grant, or malformed (not 43 base64url characters): 401 with `WWW-Authenticate: Bearer error="invalid_token"`, on `/mcp` also with `resource_metadata="https://<box>/.well-known/oauth-protected-resource/mcp", scope="mcp"`.
- `/mcp` with no token (a cookie or not): 401 with `WWW-Authenticate: Bearer resource_metadata="https://<box>/.well-known/oauth-protected-resource/mcp", scope="mcp"` and no `error` (RFC 6750 §3.1).
- A good token on a route outside its audience or its scopes: 403 with `WWW-Authenticate: Bearer error="insufficient_scope", scope="<the scope the route needs>"`. A token on a route no scope opens: 403, the same for every such route.
- **No token passes the gateway.** It strips `Authorization` from every request it forwards from the box's host or a project's host (to the hub or a dashboard), as it strips its own cookie, so no token reaches anything behind it; and it strips any `x-devteam-grant` a client sent, on every host and route, as it strips `x-devteam-person`.
- **No socket takes a token in this version.** A WebSocket upgrade carrying `Authorization` on the box's host or a project's host is refused (400); the version that adds the `/bridge` socket says how its sockets end with their grant.
- On a grant's `POST /api/thread-new` and `POST /api/thread-say` it sets `sec-fetch-site: same-origin` and `origin` to the project's own dashboard origin, as it does for the hub's own posts, then forwards with the person's `x-devteam-person` and `x-devteam-level` and the mark (§11).

## 9. Tokens

- **Form.** An access token, a refresh token and a code are each 32 random bytes in base64url (43 characters). The gateway keeps only their SHA-256 hashes (base64url), as it keeps sessions.
- **The token request** (`POST /auth/grant/token`, body at most 16 KB, else 413 with `invalid_request`) takes `grant_type`; a parameter it doesn't know is ignored, a known one repeated is `invalid_request`:
  - `authorization_code` with `code`, `redirect_uri` (the same as at authorize), `client_id` (the same), `code_verifier` (43 to 128 characters of `A-Z a-z 0-9 - . _ ~`, whose S256 is the challenge) and `resource`;
  - `refresh_token` with `refresh_token`, `client_id` (the grant's), `resource` and, optionally, `scope`.
  - `resource` names one of the grant's audiences. It may be left out only when the grant has one.
  - `scope` on a refresh may narrow the token, never widen it: a scope the grant doesn't hold is `invalid_scope`, and the grant goes on. A refresh never adds a resource.
- **The answer** is `200`, JSON, `cache-control: no-store`: `access_token`, `token_type` `"Bearer"`, `expires_in` `3600`, `refresh_token` (a new one, every time), `scope` (what the access token may do now: the grant's scopes for that audience that its person may hold now, §10) and `person` `{ "id", "name" }`.
- **Errors** are `400` JSON `{ "error", "error_description" }` with RFC 6749's codes: `invalid_request` (a missing or repeated parameter, a verifier of the wrong form), `invalid_grant` (a code unknown, used, expired, or whose verifier, redirect or client doesn't match; a refresh token unknown, ended or expired), `invalid_target`, `invalid_scope`, `unsupported_grant_type`.
- **A code** is spent by the first token request that names it, whatever that request's answer. Trading it when its person already has 20 live grants is `invalid_grant`, with "revoke one on your People page". A code presented again ends the grant it made, if it made one (`ended` `code reused`), since a replayed code is the sign of a stolen redirect (RFC 6749 §4.1.2).
- **Lifetimes.** An access token lives 1 hour. A refresh token lives 30 days from its last use (idle) and never past 90 days from the grant (absolute). Every refresh rotates it: the old one is spent. **Reuse ends the grant**: a spent refresh token presented again ends the whole grant at once (`ended` `refresh reused`), and every token of it, the newest included, is refused from then on. The gateway remembers the last 100 spent refresh hashes of each grant. There is no grace period: a client that shares a stored sign-in between processes (`devteam`'s calls, `devteam mcp`) refreshes only under an exclusive lock on its store, and reads the stored refresh token again after taking the lock.
- **Revoke** (`POST /auth/grant/revoke`, body at most 16 KB, else 413) is told apart by its content type. `application/x-www-form-urlencoded` is RFC 7009's form: `token=<a refresh or access token of the grant>`, optionally `token_type_hint`; it ends the whole grant that token belongs to and answers `200` whether or not the token was known. `application/json` is the hub's form: `{ "id": "<grant id>" }`, with a session and `Origin: https://<box>`; it ends that grant when the session may see it (§14), else 404. Any other content type is 415. An ended grant's tokens are refused at their next request.

Fixture: `token-requests.json` (steps run against a server, each with what it must answer).

## 10. The person at each use

A grant belongs to the person who allowed it. Their role and level are read at each use, from the people list as it is then, never as they were at issue:

- at authorize, `bridge` or `owner:act` asked for by someone who isn't the owner is refused, and `threads:write` for a View person is left out (§4);
- at each request and each refresh, the grant's scopes are cut to those the person may hold now: a person moved to View loses `threads:write`; a removed person's grants end with their row (`ended` `person removed`);
- `owner:act` and `bridge` work only while the grant's person is the owner. After the owner role moves to someone else, the old owner's grant keeps its other scopes and loses those two at its next request.
- At most 20 live grants per person. A 21st is refused at authorize, on the error page, with the words "revoke one on your People page".

## 11. The grant mark

On every request it forwards through a grant, the gateway sets one header:

```
x-devteam-grant: <grant id>;owner-act=<0|1>;label=<percent-encoded>
```

- `<grant id>` is `g-` and 1 to 64 characters of `A-Z a-z 0-9 _ -`.
- `owner-act` is `1` exactly when the grant holds `owner:act` and its person is the owner at that request, else `0`.
- `label` is the grant's label (§5), percent-encoded: in the header, only `A-Z a-z 0-9 - _ . ! ~ * ' ( )` and `%XX`. Decoded, it must be valid UTF-8 and meet §5's rule; it may be longer than 40 bytes as encoded.
- The three parts come in this order, with nothing else (no spaces, no other parameter).
- Only the gateway sets it, and it is in no signature: it is trusted as `x-devteam-person` is, because the gateway strips any a client sent (§8).
- A reader (a dashboard) refuses with 400 a request whose `x-devteam-grant` appears more than once (counted in `rawHeaders`), or breaks this form: a bad id, `owner-act` other than `0` or `1`, a label that decodes badly or breaks §5. Where the label is drawn or typed it is flattened as a turn's text is.

Fixture: `headers.json` (raw header lists, each with its parse or its refusal).

## 12. What a grant may never decide

**The recording rule.** A line a dashboard writes for a request that came through a grant carries `via: "grant:<grant id>"`, `via_label: "<the decoded label>"` and `owner_act: true|false` (from the mark), passed to the action's child as `DEVTEAM_PERSON` is. `log.schema.json` gains them, optional, on owner lines; `channel` keeps its values. A line with `owner_act: false` is the owner's words to talk with, never their decision:

- `answer --from-turn`, `goal decide --from-turn`, `thread ask --turn <id> --owner-said` and `correct --from-turn` refuse a turn with `owner_act` false, by its id;
- `answer --from-chat`, `goal decide --from-chat` and `correct --from-chat` refuse when the quoted words, whitespace collapsed, are contained in any turn with `owner_act` false from the last 7 days, and say to ask in the Inbox.
- The line typed into a pane for such a turn reads `[devteam thread <t-id> from owner via <label>, not a ruling]`; a turn with no mark is typed as it is today.

**The MCP rule** (binding the MCP goal): nothing reached through the `mcp` scope answers a question, presses an owner button or writes an owner line without `owner:act` on the same grant (and its person the owner at that request, §10).

## 13. `/mcp` before the MCP goal

Until the MCP goal builds its server, `POST /mcp` on `<box>`, with a good token for `https://<box>/mcp` holding `mcp`, answers JSON-RPC 2.0 (`content-type: application/json`), one request object per POST, body at most 1 MB (else 413). The `MCP-Protocol-Version` request header is not read yet.

- `initialize`: `{ "jsonrpc": "2.0", "id": <its id>, "result": { "protocolVersion": <the client's, when it is one of "2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"; else "2026-07-28">, "capabilities": { "tools": { "listChanged": false } }, "serverInfo": { "name": "devteam", "version": <the kit's version> } } }`;
- `tools/list`: `{ "tools": [] }`;
- `ping`: `{}`;
- a notification (no `id`): `202` with no body;
- any other method: the JSON-RPC error `-32601` with the message `the tools come with the MCP goal`;
- a body that isn't one JSON-RPC request object: `-32600` (or `-32700` when it isn't JSON), status 400.
- `GET /mcp` and any other method: 405.

The MCP goal puts its server behind exactly this token check and the rule of §12. Fixture: `mcp.json`.

## 14. Data: the grants record

The gateway's `state.json` gains one top-level field; `people@1` doesn't change:

```
grants: [{ id, person, client_id, client_name, label, scopes, resources, stamp, refresh_hash, refresh_expires, refresh_spent, access: [{ hash, resource, expires }], created_at, last_used, ended }]
```

- `person` is the person's id; `scopes` and `resources` are as allowed (a View person's without `threads:write`); `refresh_expires` is the earlier of 30 days after its last use and 90 days after `created_at`; `refresh_spent` holds at most 100 spent refresh hashes; `access` drops each entry once it has expired, at the grant's next write; times are ms since the epoch; `ended` is null or `{ "at", "reason" }`, the reason one of `revoked`, `refresh reused`, `code reused`, `person removed`, `passkeys changed`, `expired`.
- **`stamp`** is the `peopleStamp` the grant was issued under. A grant whose stamp isn't the current `peopleStamp` is dead, whatever else it says. The gateway's own claim, passkey add and passkey remove end every grant in the same write as the people reset.
- An older gateway keeps `grants` unread, since it saves the whole state. A reclaim there writes a new stamp, so every grant issued before is dead after rolling forward.
- `last_used` is written at most once a minute. A gateway restart ends nothing.
- **`GET /auth/grant/list`** answers `{ "grants": [{ "id", "person": { "id", "name" }, "client_id", "client_name", "label", "scopes", "resources", "created_at", "last_used", "ended" }] }`, newest first, hashes never included. A person sees their own grants; the owner sees everyone's. Fixture: `grant-list.json`.

## 15. Errors in words

Every refusal the person may see is in words, never a stack or a body from elsewhere: the error page at authorize and at the consent, `error_description` at the token endpoint, the fixed fetch reason (§6), "revoke one on your People page" (§10).

## 16. Fixtures and the fake

`test/fixtures/hub-grant/`, for `<box>` = `box.example.dev`: `as-metadata.json`, `prm-mcp.json`, `labels.json`, `redirects.json`, `metadata.json` with `metadata/*.json`, `addresses.json`, `headers.json`, `routes.json`, `paths.json`, `token-requests.json`, `mcp.json`, `grant-list.json`. Each case file is `{ "cases": [...] }`, each case with a `name` and what must happen.

`test/lib/hub-grant-fake.mjs` is an in-process authorization server that follows this contract: the two metadata documents, authorize answering at once as if the person allowed it (no consent page, no passkey, no session), token, refresh with rotation and reuse detection, both revoke forms, the list, and `/mcp`'s answers. It exports the contract's rules as functions a consumer may test against (`labelProblem`, `labelFromClientName`, `parseGrantMark`, `pathProblem`, `routeFor`, `redirectAllowed`, `addressAllowed`, `metadataProblem`). The fake is not the gateway: it has no passkeys, no consent page, no session and no network fetch (a test hands it the metadata answers), and the guards of §3's table that read a session or an `Origin` are the gateway's alone.

## 17. Not defended, and not offered

- A program running as the owner's user reading the stored tokens (`~/.devteam/hubs/<host>.json`, mode 600), as it can read their browser's cookies.
- The owner allowing a client they didn't mean to: the consent page's redirect host and its loopback warning are the only guard.
- Device-code login is not offered.
- A browser-based client (a page on another origin) can't sign in: the endpoints send no CORS headers, and the token route refuses a foreign `Origin`.
- Dynamic client registration is not offered. An MCP client that can only register dynamically, and has no Client ID Metadata Document, can't sign in to the hub by itself; it reaches the hub through `devteam mcp` (the MCP goal's stdio proxy), which uses the sign-in `devteam login` stored.
