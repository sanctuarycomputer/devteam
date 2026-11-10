# Dev links: a session shows the owner a running app

Date: 2026-11-10. Builds on `2026-11-05-artifacts-design.md` (artifacts and the Library), `2026-11-09-public-artifacts-design.md` (the gateway's names and its stance on agent content), `2026-11-04-devteam-hub-design.md` (the hub's list) and the cloud gateway (`cloud/gateway.mjs`). A design, not yet built.

## Goal

A session working in a worktree can run its project's dev server and hand the owner a link to it, before anything is committed:

```
$ devteam.mjs preview 5173 --label "the new checkout flow"
preview acme-api-01 is live at https://dev-acme-api-01.box.example.com (port 5173 answers)
Only the signed-in owner can open it. Name it in your review request; it is in the owner's Library too.
```

- **One command, and the link works.** The agent runs its server however it likes, or asks the kit to run it. No config in the project, no hooks, no harness feature: Claude Code, Codex and OpenCode all run a shell command.
- **The owner clicks.** The link is a card in the dashboard's Library, a `[[name]]` in any question that cites it, and a plain URL in the session's message. It opens on a Mac or an iPhone, signed in with the same passkey session as the hub.
- **Through the auth wall, on a name of its own.** On a cloud box the gateway proxies `https://dev-<name>.<box>` to `127.0.0.1:<port>`, after the owner's session cookie, exactly as it does for an instance's dashboard. The app gets an origin of its own and can read nothing of the owner's. Nothing about it is ever public.
- **The same thing on a laptop.** Without a gateway the link is `http://127.0.0.1:<port>`; the record, the Library card, the question link and the commands are the same.
- **Stale safely.** A link is run state, not a record. The name stays the same across server restarts; when nothing answers, the owner sees who offered it and that it is down; when the session ends, the link goes with it.

## How this compares with artifacts

The owner asked: "It's not all that different to artifacts I presume?" Half right, and the half that differs is the half that matters for the gateway.

**Like an artifact:**

- Same purpose: show the owner something instead of describing it, before it lands.
- Same place in the UI: a Library card, a question link rendered inline as `[[name]]`, nothing the owner has to go looking for. Phones work the same way.
- Same trust stance: it is agent-written content on the owner's authenticated domain, so it gets an origin of its own and can't reach the owner's API, the hub, the terminal or another instance (artifacts by a CSP `sandbox`, a dev link by its own hostname: §5). Looking at one approves nothing; a decision is a question that cites it.
- Same gate on the box: the owner's session cookie, and nobody else.
- Same shape of kit command: harness-agnostic, prints what to do next.

**Unlike an artifact:**

- An artifact is **bytes in git**: content-addressed, pinned to a question by sha256, landed through a PR, verifiable file by file, copyable. A dev link is **a process on a port**: nothing is pinned, nothing lands, nothing can be verified or copied. What the owner sees at 10:00 and 10:05 can differ, and the kit can't say how.
- So a dev link **can never be public.** Public artifacts work because the gateway fetches, checks and keeps its own copy, then serves it to anyone with no cookie and no instance in the path. A dev link is the opposite: the gateway holds nothing and forwards everything to agent code, so it stays behind the passkey, always.
- An artifact is served by the kit's dashboard with the kit's policy (sandbox, no network but CDNs). A dev app needs cookies, WebSockets for HMR, its own CSP, `eval`, fonts from wherever: it **can't be sandboxed**, which is why its isolation is the origin boundary plus the gateway's header handling, not a CSP.
- An artifact is durable (git for content, an owner `act` for a publish); a link is **run state** (`run/`), expires, and is never written to the log.
- An artifact looks the same on a laptop and a box. A dev link is a `127.0.0.1` URL on one and a hostname on the other, so the kit, not the agent, decides what to print.
- Artifacts are checked (`artifact check`, `check-pr`): no symlinks, size caps, pinned CDNs. There is nothing to check in a dev link but the port and the name.

**What they share in code:** the Library view (a "Previews" group above the artifacts), the question-link machinery (`preview` as a fifth link kind beside `path`, `url`, `link`, `artifact`), and later the viewer's frame as the host for annotation (§9). They don't share serving, storage or the publish path.

## Non-goals

- **No public previews.** Only the signed-in owner. `public.<box>` serves what the gateway holds a copy of, and it holds no copy of a running app.
- **No approval, review or trust from a link.** Opening one records nothing. A decision about what a link shows is a question, as for an artifact.
- **No body rewriting.** The gateway maps headers (as it already does for instances); it never edits HTML or JS. Apps that embed their own absolute origin in markup are a known limit, with a framework setting as the fix.
- **No annotation yet.** §9 says what this design leaves room for.
- **No new power for agents.** An agent can already serve anything on an unused instance port and appear as a tab, and can reach any localhost service itself. A dev link adds a hostname, not a capability (§5).
- **Nothing for the operator.** Previews belong to a repo's sessions.

## Design

### 1. The preview: one record per link

A **preview** is a name bound to a port on this machine, offered by a session. It lives in `run/previews/<name>.json` of the instance (home's `run/`, so a sibling-repo worker's preview sits with its instance):

```json
{ "v": 1, "name": "acme-api-01", "port": 5173, "label": "the new checkout flow",
  "by": "api-01-session-contract", "cwd": "/data/home/code/acme/.worktrees/api-01-session-contract",
  "run": { "cmd": "npm run dev -- --port {port}", "window": "dev~acme-api-01" },
  "at": "2026-11-10T09:12:00.000Z", "expires": "2026-11-17T09:12:00.000Z" }
```

- **`name`** follows the link-id rule (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`) and is at most 59 characters, so `dev-<name>` fits a DNS label (63). Default: `<project>-<session>` (`acme-api-01-session-contract`; `acme-plan-checkout` for a planner; `acme-supervisor`). `--name` overrides it, for a second server in the same session (`acme-api-01-admin`) or a shorter one. A default too long to fit is refused with the fix (`--name`).
- **`port`** is where the server listens on this machine. Allowed: 1024–65535, except the hub (4320), the instance block (4321–4345: those are instances, each with a name of its own), and on a box the gateway's own port (`PORT`) and ttyd's (7681). The kit refuses the rest with the reason.
- **`by`** is the writer (ticket id, `plan-<feature>`, `supervisor`), from `DEVTEAM_TICKET` / `DEVTEAM_FEATURE` / `DEVTEAM_ROLE`, as `artifact new` records it.
- **`run`** is present when the kit started the server (§2); `window` is the tmux window it runs in. Absent when the agent runs it itself.
- **`expires`** is 7 days after the last `preview` command for this name. A preview is never silently extended.

Names are unique per box, not per instance: the gateway can map a hostname to one port only. `preview` checks the hub's list (`http://127.0.0.1:4320/instances.json`) and refuses a name another instance already lists; without a hub, it checks only this instance. Each instance lists at most 20 previews; `preview` refuses a 21st.

The record is **run state**, like `run/dashboard-port` and `run/tmux-session`: machine-local (ports, paths, a tmux window), gitignored, swept by the same rules (§6). It is not a log line, because the log is the durable record of decisions and a link is neither durable nor a decision. `previews` joins `RUN_KNOWN`, so `fleet status` doesn't count it as a file left behind; `fleet park|drain` stops every preview first (§6), so nothing is left behind.

### 2. The kit: `devteam.mjs preview`

```
preview <port> [--name <n>] [--label "<one line>"]           register a server you are running
preview --run "<command>" [--port <p>] [--name <n>] [--label …]   the kit runs it, in a tmux window beside yours
preview list [--json]                                          this instance's previews, with whether each answers
preview url <name>                                             the link, as the owner will open it
preview stop <name> | --all                                    unregister; stops the server if the kit started it
preview start <name>                                           run a kit-started preview again (after a restart)
```

**`preview <port>`.** Writes the record, probes the port once (a TCP connect to `127.0.0.1`, then `::1`), and prints:

```
preview acme-api-01 is live at https://dev-acme-api-01.box.example.com (port 5173 answers)
Only the signed-in owner can open it. Name it in your review request; it is in the owner's Library too.
Stop it: devteam.mjs preview stop acme-api-01
```

When nothing answers yet: `… (nothing answers on port 5173 yet; the link works once it does)`. Running it again for the same name updates the port and label and extends `expires`, so a server restarted on another port keeps its link. On a laptop the first line reads `preview acme-api-01 is at http://127.0.0.1:5173 (open it on this machine; there is no gateway here)`.

The kit knows which it is on by `DEVTEAM_PUBLIC_URL`: on the box every agent's shell inherits it (`devteam-box` passes the container's environment through `as_dev`, unsetting only the claim token, and tmux hands the server's environment to every window). The URL is `https://dev-<name>.<box host>`.

**`preview --run "<command>"`.** For the common case, the kit runs the server so it outlives the agent's turn, is visible to the owner in the Terminal tab, and can be restarted by name:

- A tmux window `dev~<name>` in the project's own session (`tmuxSession()`), `-c` the caller's worktree, running `sh -c '<command>'`. Windows named `dev~*` are not sessions: `ourWindows` and the `fleet.workers` count skip them, and `worker --remove` closes them (§6).
- Without `--port`, the kit picks a free port from 4400–4499 (outside the instance block, so a dev server never takes a dashboard's port), exports it as `PORT` and substitutes `{port}` in the command. Next, Rails (`puma`), Express and Remix read `PORT`; Vite needs `--port {port}`. With `--port`, the kit exports that.
- The kit waits up to 60 s for the port to answer, then prints the same lines as above, plus the window (`running in tmux window devteam-acme-1a2b3c:dev~acme-api-01; its output is there`). A command that exits before the port answers is reported with the window's last 20 lines, and the record is written anyway (the agent fixes the command and runs `preview start`).
- `preview start <name>` runs the recorded command again in a new window of the same name, from the same `cwd`. `preview stop <name>` kills the window.

A server the agent runs itself (Claude Code's background Bash, its own tmux window, `nohup`) is registered with `preview <port>` and stopped by the agent; `preview stop` then only unregisters.

**What the agent has to know.** `process/worker.md` §7 gains a paragraph beside the artifact one: "When something is easier seen running than read: `devteam.mjs preview --run '<your dev command>' --label '…'` (or `preview <port>` for a server you already run) and name the preview in your review request. The owner sees it in the Library and can open it from a phone. Nothing it shows is approved by being seen." `supervisor.md` §6 gains the `preview` link kind; `planning.md` §2 mentions previews beside artifacts for a design with UI.

### 3. Where the owner sees it

**The Library.** A **Previews** group above the artifacts, one card per preview on this instance: label (or the name), who offered it, when, a state badge, and buttons.

| the port | kit-started | card |
|---|---|---|
| answers | either | **live** · Open · Copy link · Stop |
| doesn't answer | yes | **not running** · Start · Open (goes to the gateway's "not answering" page) · Stop |
| doesn't answer | no | **not answering** (since `<time>`) · Open · Stop |
| past `expires` | either | **expired** · Stop (removes it) |

**Open** is a plain link, `target="_blank" rel="noopener noreferrer"`, to the preview's URL for where the page is: through the gateway the dashboard's own host is `<port>.<box>`, so it builds `https://dev-<name>.<box>` (`publicHere()` already parses the host); on a laptop, `http://127.0.0.1:<port>`. Why a new tab and not the artifact viewer's frame in v1: phones do better with a tab (address bar, pinch zoom, HMR reloads), the app's own `X-Frame-Options` may forbid framing, and a frame adds nothing until there is something to put beside it (§9).

**Stop** and **Start** are owner actions through the dashboard's `ACTIONS` map (`preview-stop`, `preview-start`: `name` by the link-id rule), under the same host, origin and content-type checks as `goal-hold`. Stop for an agent-run server only unregisters; the card says so ("the server stays up until its session stops it").

**Hello and the hub.** `/api/hello` gains `previews: [{ name, port, label, by, at, up }]`, read from `run/previews/` and probed (one TCP connect per record, 300 ms) when `helloBody()` is asked, not on the 10 s `hello` run, so a new preview is in the list at once. Each string is capped (`name` 59, `label` 120, `by` 80), the array at 20. The hub passes each instance's hello through unchanged, so the gateway reads previews from the list it already polls.

**A question.** `ask --links` gains `preview`, a fifth kind beside `path`, `url`, `link` and `artifact`: `{"name":"demo","title":"The new checkout, running","preview":"acme-api-01"}`, cited inline as `[[demo]]`. `ask` refuses a preview this instance doesn't have. The dashboard renders it as a link to the preview's URL for this machine with its state beside it (live, not answering, gone); the question's own text is hashed as always, and the record names only the preview's name, never a port or URL, so a question asked on a laptop reads right on the box. A worker never asks the owner directly: it names the preview in its `review-request` ("preview acme-api-01 shows the new flow"), and the supervisor's question carries the link.

**The Inbox and push.** A question that cites a preview is an Inbox item like any other, so the existing push ("`<name>`: 1 new in the Inbox") brings the owner to it; tapping the card's `[[demo]]` opens the preview. No separate notification for a preview on its own: a link with no question is something to glance at, not an interruption, and push text is agent-written.

**The hub.** No change in v1. A `Previews` link beside `Passkeys` in the hub's header, to the gateway's own list page `https://<box>/dev/` (every preview on the box, each with its instance, state and Open), is cheap and useful on a phone; it is in the first version if time allows, and otherwise next.

**From an iPhone.** A link opened in Safari is signed in if the hub was used in Safari. From the installed (Home Screen) hub, a link outside the hub's scope opens in an in-app browser with its own cookies, so the first preview opened there asks for the passkey once; after that its 14-day session holds. The README's hub notes say so.

### 4. The gateway: routing

**Names.** `dev-<name>.<box>`, one label under the wildcard the box already has (`*.box.example.com`), so DNS and the certificate need nothing new. A wildcard matches exactly one label, so `<name>.dev.<box>` would need a second wildcard and, on Render, a second set of records; the `dev-` prefix keeps the name under the existing one and can never collide with an instance (all digits), `term` or `public`. The gateway matches `^dev-([a-z][a-z0-9]*(-[a-z0-9]+)*)\.<box host>$` with the inner name at most 59 characters.

**The map.** The gateway already reads the hub's list every 10 s for notifications (`pollPush`). The same read builds `devLinks: Map<name, { port, root, label, by }>` from each instance's `previews`, with the same care as `inboxNews`: instances deduplicated by port and root, each entry checked (`name` pattern and length, `port` an integer in the allowed set of §1 as the gateway sees it, strings capped), first instance by root order wins a name (a collision is logged once). Nothing is persisted: the map is whatever the list said last. A request for a `dev-` name not in the map asks the hub once more (`hubList()`, typically a few hundred milliseconds; the hub caches 2 s) before answering, so a link printed a moment ago works on the first click.

**A request.** Same checks as an instance, in the same order: own names only (421 otherwise); any method but GET/HEAD must carry `Origin` equal to the link's own origin (403); no service workers (403: a worker registered on this name would outlive the server and run as whatever next answers on it); `crossSiteOk` as now; then the session cookie, with a redirect to sign-in for a navigation and 401 otherwise. Then:

- **Known name, port answers:** proxy, with the headers below.
- **Known name, nothing answers:** the gateway's own page (`PAGE_CSP`): "Preview `<label>` (offered by `<by>` on instance `<root>`) isn't answering on port `<port>`. Its server may be starting, or stopped. This page retries every 5 s." with a `<meta http-equiv="refresh" content="5">`. Values are escaped; nothing from the list is followed as a URL.
- **Unknown name:** the gateway's own page: "No preview named `<name>` on this box", with the current names as links. Also with a 5 s refresh for a few minutes, since a `preview` command may be a second behind.

**Upstream headers.** As `upstreamHeaders` does for an instance, with two changes:

- `Host: localhost:<port>`, and when the browser's `Origin` is the link's own origin, `Origin: http://localhost:<port>`; any other `Origin` passes as is (non-GET requests with one never got this far). Instances use `127.0.0.1:<port>`; dev links use `localhost` because that is what dev servers expect: Next 16 refuses dev assets and its HMR socket when the `Origin` hostname isn't `localhost` (it refused `127.0.0.1` in a test, §What was checked), Rails' forgery protection (`forgery_protection_origin_check`, on since 5.0 defaults) requires `Origin` to equal the scheme and `Host` of the request, and Vite allows `localhost` and any IP. With `Host` and `Origin` both `localhost:<port>`, all three pass without any setting in the project.
- `cookie`: `devteam_session` removed, the rest passed (the app's own cookies). `referer`, forwarded and platform headers dropped, as now. The upstream connection goes to `127.0.0.1`, then `::1` on refusal (a server bound to `localhost` may sit on either).

**Downstream headers.** `downstreamHeaders` as for an instance: `set-cookie` with a `Domain` attribute dropped, one named `devteam_session` dropped, `strict-transport-security` and `clear-site-data` dropped, the gateway's HSTS added, `cache-control: no-store` forced (the same reason as for instances: a name must never serve yesterday's page from the cache once something else answers on it; dev servers mostly send `no-cache` anyway). `mapLoop` learns this link's port: `http://localhost:<port>` and `http://127.0.0.1:<port>` in `location` and `content-security-policy` become the link's origin, so a dev server's redirect to itself lands on the link, and a CSP that names itself still allows itself. Other ports aren't mapped (a redirect to another local port is the agent's problem to register).

**WebSockets.** The `upgrade` handler, today the terminal's alone, takes `dev-` names too: a session cookie, `Origin` equal to the link's own origin (browsers always send it on a WebSocket; refused otherwise), then a raw TCP connection to the port with the request line and the mapped headers (`Host`, `Origin`, cookie), as the terminal's socket is relayed. At most 32 open sockets per name, so a reconnect loop in an HMR client can't exhaust the gateway. Vite's HMR client connects to the page's own `host:port` by default (through the gateway, `wss://dev-<name>.<box>/`), carrying its token in the query string, which passes through untouched; Next's connects to `/_next/webpack-hmr` on the same origin. Both work with the header mapping above and no setting in the project (checked, below).

**Limits.** Request and response bodies stream, with Node's five-minute body timer as for every non-upload request; headers 64 KB (as now); 32 sockets per name; 20 previews per instance and 25 instances, so at most 500 names. The owner is the only client, so this is about a runaway app, not an attacker.

### 5. Security

The box's public edge is the gateway, and a dev link is agent-written code answering on the owner's authenticated domain. What holds:

- **Its own origin.** `https://dev-<name>.<box>` is a different origin from the hub (`<box>`), sign-in (`<box>/auth`), the terminal (`term.<box>`), every instance (`<port>.<box>`), the public site and every other preview. Same-origin policy keeps the page's scripts out of all of them. What it can do to them is what any instance page can already do, no more:
  - **Reads with the owner's cookie:** the cookie is `SameSite=None` and `Domain=<box>`, so a `fetch` or `<img>` from a preview to an instance or the box carries it. Those requests say `Sec-Fetch-Site: same-site`, which `crossSiteOk` refuses except for a top-level navigation (never to `/api/`) and the two review helpers; a cross-origin response is unreadable without CORS headers, and nothing behind the gateway sends any.
  - **Writes:** every non-GET needs `Origin` equal to the target's own origin; a preview's is different, so 403 at the gateway, before the kit or the terminal's upload route is reached.
  - **Framing the owner's pages:** the hub is `frame-ancestors 'none'`, the dashboards allow only themselves and the hub, the terminal only the hub.
  - **Navigating the owner:** a preview can `window.open` or redirect the owner to a box page. That page acts only on its own clicks, as today. A redirect to `http://localhost:<port>` on the owner's own laptop reaches nothing it could act on without `Origin`.
- **Cookies.** The gateway strips `devteam_session` upstream, so the app never sees the token. The app's `Set-Cookie` with `Domain=` is dropped, so its cookies are host-only on its own name and can't shadow or clash with anything on another name. A page can still set a domain cookie from script (`document.cookie`), as an instance page can; `sessionOf` ignores a `devteam_session` that matches no live session, and a stuffed jar gets the 431 `clear-site-data` answer that costs a sign-in. The README already tells the owner to give the box a domain of its own for this reason; the dev-link paragraph repeats it.
- **Passkey prompts.** The relying party is `<box>`, the parent of every name, so a preview page can raise a genuine passkey prompt, as an instance page can. The gateway accepts only answers from `<box>` itself. The README's warning gains "or a preview's".
- **Service workers.** Refused on `dev-` names as on instances (`service-worker` header or `sec-fetch-dest: serviceworker`). The name is stable while the thing behind it changes, which is exactly when a worker is dangerous.
- **CSP and framing of the preview itself.** The gateway adds no CSP and no `frame-ancestors` to a preview's responses: the app's own headers rule, mapped where they name the loopback origin. (A frame of a preview inside the dashboard is the annotation host of §9; an app that forbids framing opens in a tab only.)
- **`Origin` upstream.** Rewritten to `http://localhost:<port>` only when it was the link's own origin, so the app's CSRF checks see a same-origin request for what the owner's page did, and a cross-site one for anything else.
- **Who can see a link.** The signed-in owner, on any device with a session. No link is reachable without the cookie; a navigation without one is sent to sign-in, as an instance's would be. Nothing in a registration touches `public.<box>`, which reads only the gateway's own state and blobs.
- **What a registration can expose.** An agent can register any local port: a Postgres pgweb it started, another session's dev server, a tool that scrapes `127.0.0.1` services and renders them. Compared with what it can already do, nothing: it can serve any of that on an unused instance port today and appear as a tab, it can connect to every localhost service itself, and it shares the box's user and logins. The gateway still refuses its own port, the hub, the instance block and ttyd, and anything under 1024, so no registration can make the gateway relay the gateway, or put a dashboard behind a second name with different headers.
- **What a registration can't do.** It can't read or set the owner's session, can't make anything public, can't act on the kit (`ACTIONS` need the dashboard's own origin), can't count as a review or an approval (§8), and can't survive the record: a stale list drops the name within one poll.
- **Rate and size.** Headers 64 KB; bodies streamed; 32 sockets a name; 500 names a box. No `Range` handling or caching layer in the gateway. The hub's list is capped at 1 MB as now, and a hello at 64 KB.
- **Text from the list** (labels, names, roots) is shown escaped on the gateway's pages and never followed as a URL, as the push code treats it.

### 6. Lifecycle

| event | what happens |
|---|---|
| `preview` | record written; the dashboard lists it at once; the gateway maps it within 10 s, or on the first request for it |
| the server stops | the card says "not answering" (or "not running" for a kit-started one, with Start); the gateway's page retries every 5 s; the name is kept |
| the server comes back on another port | the agent runs `preview <newport>` (same name): same link |
| `preview stop` | the record is removed; a kit-started window is killed; the gateway drops the name within 10 s |
| the owner clicks Stop | same, through the dashboard action |
| the ticket merges | `worker --remove` kills every `dev~*` window whose record names this writer and removes those records, as it removes the worktree |
| the session is parked or the fleet drains | `fleet park|drain` and `worker … --remove` stop every preview of the sessions they stop; the handoff note lists what was running (`preview list --json`), so the resumed session can `preview start` it |
| the box restarts | records are on `/data`; dashboards come back and list them as not running; servers don't (nothing runs them). A resumed worker's prompt carries a line per kit-started preview of its own: "your preview `<name>` (`<cmd>`, port `<p>`) is not running; `devteam.mjs preview start <name>` brings it back" |
| `expires` passes | the dashboard drops the record and closes a kit-started window; the card is gone after the next refresh; the gateway follows the list |
| the port has not answered for 24 h and the record isn't kit-started | swept (the agent's server is gone for good); a kit-started one waits for Start or expiry |
| the dashboard stops | the hub stops listing the instance; its names vanish from the gateway within 10 s and come back when the dashboard does |

No orphans: every record belongs to a writer whose worktree removal clears it, every record expires, and the gateway holds nothing of its own.

Where the sweep runs: in the dashboard's `hello` run (every 10 s), which already touches `run/`, so a laptop with no supervisor sweeps too.

### 7. The laptop

Same command, same record, same Library card, same question link. `preview` prints `http://127.0.0.1:<port>` because `DEVTEAM_PUBLIC_URL` is unset; the card's Open goes there. No gateway, no names, no WebSocket relay: the browser talks to the dev server. The hub lists previews in each instance's hello as on a box, which nothing on a laptop reads yet. A fleet moved from a laptop to a box keeps its question links readable: the link names the preview, not an address, and the box resolves it its own way.

### 8. Fit with existing concepts

- **Run state, not the log.** A preview is like a dashboard port or a tmux session name: this machine's, gone with it, rebuilt by a command. It is never a log line: the log carries decisions and their records, and a running process is neither. A question that cites a preview is the durable thing, and it names the preview, not the port.
- **No act, no class, no rung.** Offering a preview is not a decision; opening one is not an approval. Nothing on the trust ladder changes. `constitution.md` gains one sentence under the artifact one: "A preview (a running dev server the owner can open) is run state, approves nothing, and is never a record."
- **Artifacts and previews side by side.** Same Library, same `[[name]]` rendering, same worker/supervisor guidance ("mock first, or run it, then ask"). An artifact is for a thing drawn to be looked at; a preview for the thing being built. The viewer stays the artifact's; a preview opens in a tab until §9.
- **The hub's list** stays the one channel from the agents' side to the gateway, as for notifications and public manifests: nothing new listens, nothing new is written where `gw` reads, and the gateway treats what it reads as untrusted data from whoever holds the port.
- **The operator** has no previews and no new commands.

### 9. Room for annotation

The owner wants, later, to leave QA notes on what a link shows. What this design settles so that is a next step, not a redesign:

- **A stable identity.** A preview has a name that outlives ports and restarts, and an origin of its own. A note can be keyed to `(preview name, path, viewport)` and stay meaningful across server restarts.
- **A companion frame, not injection.** The dashboard's artifact viewer already frames content with a header and a Reload. A preview can be framed the same way (cross-origin, so the dashboard can't read into it, which is right), with a notes column beside it: path, screenshot, text, each note a question-like record the session reads. The gateway never has to rewrite the app's HTML, which would fight compression, streaming and HMR, and would put gateway code inside agent pages. What would make the companion frame hard: an app that sends `X-Frame-Options: DENY` or `frame-ancestors` without the dashboard's origin. The fix is on the agent's side (its dev config), and the kit's `preview` can print the one line to add when the time comes; the gateway should not strip those headers.
- **Screenshots from the box.** The image has Chromium. A `preview snap <name> [path]` that renders the page headless on the box and drops the PNG in the ticket folder is a small addition, and gives notes something to point at even after the server is gone.
- **The record of a note** would be a log line that names the preview, the path and the owner's words, by the owner, to the session: a question in reverse. The schema's `refs` can carry `preview:<name>` as it carries `artifact:<slug>`.
- **What to avoid now:** path-prefix routing (notes would key on mangled paths), body rewriting, and any gateway state about previews (a note must not depend on the gateway remembering anything).

## Scope and sequence

**First version (feels magical):**

1. **Kit** (one PR, works on a laptop end to end): `preview <port>`, `preview --run`, `list`, `url`, `stop`, `start`; the record and its rules; `previews` in hello; the Library's Previews group with Open, Copy link, Stop and Start; the `preview` link kind in `ask` and the dashboard; cleanup in `worker --remove`, `fleet park|drain`; the resumed worker's prompt line; `dev~*` windows skipped by `ourWindows`; `RUN_KNOWN`; docs (worker.md §7, supervisor.md §6 and §9, planning.md §2, README tree and agent docs, constitution one line).
2. **Gateway** (a second PR, deploys the box at its release): `dev-` names in `instanceOf`'s neighbourhood, the map from the hub's list with on-demand refresh, the proxy with `localhost` headers and the port-aware `mapLoop`, the WebSocket relay, the three pages (not answering, unknown, and the list at `/dev/`), the hub's `Previews` link, README cloud section and threat-model bullets.

**Deliberately left out:** public or shared previews; restarting kit-started servers at boot (an open question below); framing in the dashboard and anything annotation; body rewriting; `Host` passthrough; screenshots; previews for the operator; any new hub UI beyond one link.

**Risks:**

- A dev server that builds absolute URLs into markup from `Host` (`http://localhost:5173/...` in HTML) breaks through the gateway; redirects and CSP are mapped, bodies aren't. Rare in dev servers; the fix is the framework's host setting, which the kit's "not answering / looks wrong?" text can name.
- A server bound to `::1` only: the gateway tries `127.0.0.1` then `::1`.
- Platform idle timeouts on WebSockets (Render and fly support them; idle ones may be cut). HMR clients reconnect.
- Cookie-jar stuffing from a preview's script: the existing 431 answer; the domain-of-its-own advice stands.
- `no-store` on every asset makes a heavy app slower on a phone than the agent's laptop experience. Accepted for safety; revisit if it bites.
- A name over 63 characters: refused with `--name` as the fix.
- The `dev~` window: a worker that splits or renames windows could hide one from `preview stop`; `worker --remove` kills by name, and `expires` catches the rest.

## Open questions for the owner

1. **Name shape.** `dev-<project>-<session>.<box>` (recommended: one label under the existing wildcard, no DNS or certificate work, visibly agent code, never collides with an instance, `term` or `public`), or `<session>.<box>` (shorter, but a reserved-name collision is one bad project name away), or `<name>.dev.<box>` (reads best, needs a second wildcard and on Render a second set of DNS records).
2. **Restart kit-started servers after a box restart?** Recommended: not in v1 (the resumed worker gets a prompt line and runs `preview start`); yes in v2 for `--run` previews only, from the dashboard as it comes up, since the command is the agent's own and already ran once as `dev`. The question is whether you want processes starting at boot that no session asked for that day.
3. **Open in a tab or in the dashboard's viewer?** Recommended: a tab in v1, the viewer frame as the annotation host in v2.
4. **Should the owner's Stop kill an agent-run server?** Recommended: no, it only unregisters (the kit didn't start it and can't find it reliably); Stop kills what the kit started.
5. **Expiry.** 7 days from the last `preview` command, and 24 h of not answering for an agent-run one. Recommended as is; a session that wants longer runs `preview` again.
6. **The box-wide list page** at `https://<box>/dev/`, linked from the hub. Recommended: yes, it is one gateway page and the best phone entry point; do it in the gateway PR.
7. **`no-store` on preview responses.** Recommended: keep it, as for instances, and revisit only with evidence.
8. **A `Host` passthrough option** for apps that want to see their public name. Recommended: not in v1; document the framework settings (`server.allowedHosts`, `allowedDevOrigins`, `config.hosts`) for an owner who needs it.

## Testing

**Kit (`test/kit.test.mjs`, `test/dashboard.test.mjs`):** `preview <port>` writes the record and prints the laptop URL, and the box URL with `DEVTEAM_PUBLIC_URL`; refuses the hub port, the instance block, a bad name, a name over 59 characters, a 21st preview, a name another instance lists (a fake hub); updates the port for a known name and extends `expires`; `--run` opens a `dev~<name>` window (a private `TMUX_TMPDIR`), exports `PORT`, substitutes `{port}`, and `stop` kills it; `ourWindows` skips `dev~*`; hello lists previews with `up` from a real listener and caps strings; the Library data carries them; `ask --links` with `preview` records the name only and refuses an unknown one; `worker --remove` clears the records and windows of that writer; `fleet status` doesn't count `run/previews`; the expiry and 24 h sweeps.

**Gateway (`test/gateway.test.mjs`):** with a fake hub listing a preview and a small dev server (HTTP and a WebSocket echo) on a scratch port: a navigation without a session redirects to sign-in; with one, the response is the dev server's, which saw `Host: localhost:<port>`, no `devteam_session`, `Origin: http://localhost:<port>` when the browser sent the link's origin and an unchanged one otherwise; a `Set-Cookie` with `Domain` is dropped and a host-only one passes; a `Location: http://localhost:<port>/x` comes back as the link's origin; `cache-control` is `no-store`; a POST from another origin is 403; a service-worker fetch is 403; the WebSocket relays frames both ways and refuses a wrong `Origin` or no session; a 33rd socket is refused; a port outside the allowed set in the list is ignored; an unknown name gets the gateway's page listing the known ones; a name the next list drops is gone; nothing answering gets the retry page; the list page shows every name and the hub's `box.json` is unchanged. The existing instance tests still pass with `127.0.0.1` headers.

**Manual, on a real box:** a Vite app and a Next app behind `dev-` names, HMR working, from a Mac and an iPhone (Safari and the installed hub); Rails if a repo on the box has one.

## Docs

- README: the tree (`run/previews/`), the agent docs paragraph (a sentence after artifacts), the cloud section (a **Dev links** bullet: what they are, the name, owner-only, how they end) and the threat-model bullets (cookies and passkey prompts now say "an instance's or a preview's name").
- `process/worker.md` §7, `process/supervisor.md` §6 and §9, `process/planning.md` §2, `constitution.md` one sentence.
- `cloud/gateway.mjs` header comment and `cloud/Dockerfile` header: the `dev-` names.

## What was checked

Experiments ran on this Mac on ports 4611 and 4612, in a scratch folder, and were stopped afterwards.

- **Vite 5.4.21.** `GET /` with `Host: dev-x.box.example.com` is refused (403, "This host is not allowed"); with `Host: 127.0.0.1:4611` or `localhost:4611` it is served. The injected HMR client (`/@vite/client`) has `hmrPort = null` and connects to `${location.hostname}:${location.port}`, so through the gateway it connects to the link's own name on 443; a direct `127.0.0.1:<port>` fallback is tried only if that fails. Its WebSocket upgrade requires an allowed `Host` and, when an `Origin` header is present, the client's `?token=` in the URL (`shouldHandle` in Vite's `ws.ts`); the `Origin` value itself isn't compared. So: `Host` rewritten to a loopback name, query string passed through, nothing to configure.
- **Next 15.5.29.** No `Host` or `Origin` check observed on pages, dev assets or the HMR upgrade.
- **Next 16.4.6** (Turbopack, default hostname). Pages are served with any `Host` or `Origin`. Dev assets (`/_next/static/...`) with an `Origin` header are served when its hostname is `localhost` (any port) and refused (403, "Blocked cross-origin request … add it to allowedDevOrigins") for `127.0.0.1` or the public name; with no `Origin` they are served. The HMR upgrade (`/_next/webpack-hmr`) answers "Unauthorized" for `Origin` `http://127.0.0.1:4612` or the public name and proceeds for `http://localhost:4612`. Hence `localhost`, not `127.0.0.1`, upstream.
- **Rails** (docs, not run): development `config.hosts` allows every IP address and `localhost` by `Host`, and `X-Forwarded-Host` is checked too, so the gateway must not add one; `forgery_protection_origin_check` (default on since the 5.0 defaults) requires `Origin` to equal `request.base_url`, hence `Origin` and `Host` must agree.
- **Wildcard certificates** match one label (RFC 6125 §6.4.3), so `dev-<name>.<box>` is under the existing `*.<box>` and `<name>.dev.<box>` is not.
- **The box's environment.** `devteam-box` runs `devteam-dev` through `as_dev`, which passes the container's environment and unsets only `DEVTEAM_CLAIM_TOKEN`, so `DEVTEAM_PUBLIC_URL` reaches every agent's shell through tmux.

Not checked: real-browser HMR through a real gateway (only the servers' answers to the headers the gateway would send), Render's and fly's WebSocket idle behaviour, and the iPhone's in-app browser cookie behaviour for links opened from the installed hub (the README's existing note is the basis).
