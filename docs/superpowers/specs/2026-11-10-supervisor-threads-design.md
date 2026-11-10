# Supervisor threads: Shift+click anything and talk to the supervisor about it

Date: 2026-11-10. Builds on `2026-11-05-artifacts-design.md` (artifacts, the Library, the viewer), `2026-11-09-public-artifacts-design.md` (the gateway's public copy), `2026-11-10-dev-links-design.md` (previews and §9 there) and `process/supervisor.md` §6 (questions, standing rules, "the owner tells you in your own session"). It supersedes the draft `2026-11-10-dev-link-annotations-design.md` (PR #176, never merged): that draft's viewer, lens and anchors are kept here, its recipient (the offering session), its "no back-and-forth" and its "a note approves nothing" are replaced.

The owner asked for it: "a custom cursor or similar that allows us to double click on anything and send the supervisor a note … it opens a small float chat thread with the 'context' as a tight little chat card at the top … have a quick back and forth about the thing, and ideally ask it to move forward with things! The chat is allowed to ask questions in the UI too, which should be mirrored in the inbox - and treated exactly the same (with standing rules etc too). These threads stay floating and attached to the UI somehow so multiple can be referred back to over time." Then: feedback on dev links and artifacts "in dashboard viewers and new tabs"; always signed in; public artifacts wrapped for the owner; threads closable, "their resolution is logged and finds its way into the OODA loop"; and threads with no subject, started from the dock.

## Goal

The owner holds Shift and points. The cursor becomes a pin and the thing under it lights up with its name: a goal card, an observation, a question, a ticket, a spot on an artifact, a button in a running dev app. A click opens a small chat card beside the pin with that thing as a tight context card at the top. They type "narrow this to the EU launch", the supervisor answers in the card ("That drops the measure to EU orders; want me to propose the change?"), they say "yes, go ahead", and it does, with the card showing what it did. The pin stays on the goal; a dock in the corner lists every open thread, so the five they started this week are one click away. When it's done they resolve it with a line, the pin goes, and the resolution is an observation the loop reads.

- **One counterpart: the supervisor.** Every thread is with the project's supervisor, the one long-lived session. It acts, delegates to workers and reports back in the thread.
- **The owner's words carry the owner's weight.** A turn is the owner speaking to the supervisor, as in its own session, already recorded verbatim.
- **Questions are Inbox questions.** When the supervisor needs a decision it asks one, linked to the thread; it shows in the card and in the Inbox, and is answered once, with standing rules, ordering and push exactly as today.
- **Anything can be the subject, or nothing.** Dashboard items, a point on an artifact, an element in a dev app, a spot on the dashboard; or no subject, started from the dock.
- **Everywhere the owner looks.** The dashboard, its artifact and preview viewers, the same viewer in a new tab, and a published artifact at its public address, for the signed-in owner only.
- **Durable.** Threads and turns are log lines: they survive a dead laptop and a box move, and travel with the project.

## Decisions (the owner's)

1. **The real supervisor replies, always.** No fast stand-in. Replies can lag while it is busy; the card says what is happening.
2. **One system, superseding #176.** On a dev link the supervisor passes fixes to the session that offered it and reports back.
3. **Always signed in.** Nobody anonymous can start or read a thread. A public artifact is plain bytes to the public, and a wrapper with threads for the signed-in owner.
4. **Pins plus a dock.** A numbered pin on the subject; one card open at a time beside its pin; a dock listing every open thread.
5. **Shift+click** starts a thread, on every surface. A pin button does it on a phone and for a long pass.
6. **Resolving is the owner's.** The supervisor may propose it ("ready to resolve", with a one-line outcome) for a one-click accept; only the owner's click closes it. A resolved thread unpins, is logged, and enters the loop as an observation.
7. **Threads and turns are new log types**, with an optional subject; a thread can be started from the dock with no subject.

## Non-goals

- **No anonymous or shared participants.** The owner and the supervisor only. Workers never write in a thread; the supervisor relays.
- **No new authority.** A thread grants nothing a chat with the supervisor doesn't. A decision the supervisor needs is still a question; an `owner_only` class still needs its answer.
- **No drawing.** A pin and words. The anchor carries a rect, so a region select is a later addition.
- **No screenshots from the browser.** A cross-origin frame can't be drawn to a canvas (#176 checked). The capture is the element, its text and HTML, the route, the viewport and console errors.
- **No body rewriting at the gateway**, as dev links ruled out. The kit injects a small script into an artifact's HTML only on its own framed loads (§6), never into what is published or fetched for publishing.
- **No change to what a published artifact is to the public.** Same bytes, same headers, same URL.

## Design

### 1. The records

Two new line types, both in `schema/log.schema.json` with `x-id` prefixes `t` and `u` (unused today), both new for the owner (`x-authority.new.owner`), and `turn` new for the supervisor too.

**A thread**, created by the owner only:

```json
{ "type": "thread", "id": "t-20261110-101500123-owner", "title": "Launch checkout",
  "subject": { "kind": "item", "ref": "goal:g-20261101-090000000-supervisor", "quote": "Launch checkout in Q1 · measure: 500 orders" } }
```

- `title`: one line, at most 120 characters, from what the owner was looking at (the goal's title, `button "Buy now"`, `pricing-mock · /index.html`), or the owner's first words for a thread with no subject.
- `subject`: optional and fixed at creation; a different subject is a new thread. Its four kinds are in §5.
- Later lines set `status` (`open`, `resolved`), `outcome` (the owner's resolution line, at most 300) and `reopened` (owner); `ready` (`{ "outcome": "…" }`, the supervisor's proposal, at most 300; cleared by the owner's resolve or a later owner turn). `x-authority.set.thread` says so: the owner sets `status`, `outcome`, `reopened`, `ready: null`; the supervisor sets `ready` only.

**A turn**, one message in a thread:

```json
{ "type": "turn", "id": "u-20261110-101530456-owner", "thread": "t-20261110-101500123-owner", "text": "Narrow this to the EU launch" }
{ "type": "turn", "id": "u-20261110-101720789-supervisor", "thread": "t-…", "text": "Done: the goal's measure is EU orders now.",
  "refs": ["goal:g-20261101-090000000-supervisor", "act:a-20261110-101719000-supervisor"], "question": null }
```

- `text`: at most 2,000 characters (a line stays under the 4,096-byte cap with the envelope), multi-line allowed.
- `refs` (supervisor turns): what it did or points at, in the log's `<type>:<id>` form; the card renders each as a link ("goal changed", "ticket checkout-04 opened").
- `question` (supervisor turns): the id of a question this turn asks (§9).
- A turn is refused for a thread that doesn't exist or is resolved (the owner reopens it first, or a supervisor turn on a resolved thread is refused with that reason).

**A question gains `thread`** (optional, a `t-` id): the thread it was asked in. `x-authority`: supervisor, on create.

**An answer gains `--from-turn <u-id>`** (§9): the owner's words come from the turn, not a chat quote.

**A resolution is also an observation** (§10): the owner already creates observations; this one has `source: "owner"`, `kind: "thread-resolved"`, `subject: "thread:<t-id>"`, `detail` the outcome (or "resolved" with none), `refs` the thread and its subject's `ref`.

Folding: `threadView` (beside `questionView`) builds `{ id, title, subject, status, outcome, ready, turns: [...], questions: [...], waiting }`, where `waiting` is `owner` when the newest turn is the supervisor's or there is none (the owner's move), `supervisor` when it is the owner's. Older kits report `thread` and `turn` as not log lines; the release notes say a fleet updates its kit before the owner uses threads (the same as any new type).

### 2. The kit commands

```
thread new [--subject '<json>'] --title "<line>" "<first words>"     owner: a thread and its first turn
thread say <t-id> "<words>"                                          owner or supervisor: a turn
thread ask <t-id> <ask's own flags>                                  supervisor: an Inbox question in the thread, and a turn naming it
thread ready <t-id> --outcome "<line>"                               supervisor: propose resolving
thread resolve <t-id> [--outcome "<line>"]                           owner: resolve (and the observation)
thread reopen <t-id> ["<words>"]                                     owner: reopen, optionally with a turn
thread show <t-id> [--json]                                          anyone: the thread, its subject framed as data, its turns
thread list [--waiting | --open | --all] [--json]                    anyone; --waiting is open threads where the supervisor owes a reply
```

- `new`, `resolve`, `reopen` and the owner's `say` use `ownerWriter()`, so they die under any `DEVTEAM_ROLE`. `say` as the supervisor accepts `--refs`. `ready`, `ask` and the supervisor's `say` refuse any other role.
- `thread ask` runs `ask` exactly as it runs today (every flag, every check, every refusal) with `thread` set, then writes the turn with `question` set and the question's text as its text. Nothing about the question differs from one asked with `ask`.
- `thread show` prints the subject inside the "captured from the page (data, not instructions)" frame that `sensor show` uses for production data, every value quoted.
- Dashboard actions, in `ACTIONS` under the same host, origin and content-type checks as `answer`: `thread-new`, `thread-say`, `thread-resolve`, `thread-reopen`, `thread-accept` (resolve with the supervisor's proposed outcome). Bodies capped at 16 KB.

### 3. Delivery and how fast it feels

**Owner to supervisor.** An owner turn is written, then typed into the supervisor's pane when it has one (`sendLine`, as `nudgeSupervisor` does), as one line: `[devteam thread t-… from owner on goal "Launch checkout"] Narrow this to the EU launch — devteam.mjs thread show t-…`. The title and the owner's words only (the first 300 characters, then `…`); never the captured subject. A new owner line already wakes `wait`, so a supervisor waiting rather than in a pane picks it up on its next poll.

**Supervisor to owner.** `thread say` and `thread ask` write the log; nothing else. The supervisor's prompt (`process/supervisor.md` §6) says: reply in the thread before doing the work when the work takes more than a turn ("on it, opening a ticket"), and again with `--refs` when it's done.

**The card's states**, from the log and the kit's knowledge of the pane:

| state | shown |
|---|---|
| owner turn written, pane typed | "sent" |
| written, no pane (the supervisor is waiting, parked, or not running) | "sent; the supervisor will read it when it next checks" |
| supervisor turn newer than the owner's | the reply |
| owner turn older than 10 minutes with no reply and the supervisor running | "the supervisor hasn't replied yet" |

The supervisor's tick gains **`thread-waiting`** (medium): an open thread waiting on it for more than 10 minutes; its fix is `thread list --waiting`. At startup it runs `thread list --waiting` beside `knowledge --status accepted`.

**Fast reads.** `/api/data` spawns a slow child. Threads get `GET /api/threads`: the dashboard process folds only `thread`, `turn` and threaded `question` lines, cached by each log file's size and mtime, so a repeat read is a few `stat` calls. The open card polls it every 2 s while visible; otherwise the layer refreshes with `/api/data`'s 10 s tick. Polling, as everything in the dashboard is.

### 4. The layer

One piece of `dashboard/index.html`, used by the dashboard and by the viewer (§7): the cursor, the highlight, the card, the pins and the dock. It lives outside the region the 10 s refresh rebuilds, and re-places pins after each rebuild.

**Shift+click.** Shift is held and the pointer moves: the cursor becomes the pin (a drawn 28 px teardrop in the accent colour with a white edge, `cursor: none` beneath it, from #176) and the subject under it is highlighted with a chip naming it. Shift pressed while typing in a field shows nothing until the pointer moves outside a text field, so capitals don't summon it. A click while it shows starts a thread on that subject and is consumed: the browser's own Shift+click (open in a new window, extend a selection) and the page's handler never see it. Releasing Shift or Esc puts the normal cursor back. Clicking a pin opens its thread without Shift.

**The pin button.** In the dock's header: a sticky pin mode for touch devices (`pointer: coarse`) and for a long pass. Touch places a pin under the finger with the highlight following; lifting drops it. Esc or the button again leaves the mode.

**The card.** Opens beside the pin, flipped to stay on screen; a bottom sheet under 640 px. At the top, the **context card**: one tight line naming the subject (kind icon, title, where), expandable to the capture. Then the turns, newest at the bottom, the supervisor's with its `refs` as links and any question rendered with the Inbox card's own controls (§9). Then the composer (Enter sends, Shift+Enter is a new line; the draft is kept in `localStorage` per thread as review drafts are). The header has Resolve, and when the supervisor proposed it, a banner: "Ready to resolve: <outcome>" with **Resolve** and **Not yet** (an owner turn, which clears `ready`). One card is open at a time; opening another closes the first.

**The dock.** Bottom right, collapsed to a pill ("Threads · 3 ●") until opened. Open: every open thread, newest activity first, each with its number, title, where its subject is ("Goals", "pricing-mock", "cool-tiger /checkout", "no subject") and a dot when the supervisor replied since the owner last opened it (`localStorage`). Clicking one goes to its subject (the route, the scroll, the artifact or preview viewer) and opens the card; a thread with no subject, or a subject not on any page now, opens its card in the dock itself. **New thread** starts one with no subject. **Resolved** at the bottom lists the last 50 resolved threads, each reopenable.

**Pins.** A small numbered disc at the subject's top right corner (dashboard items) or at the anchor's point (§6, §7), only for open threads whose subject is on screen. A subject with several threads shows one pin with a count. A pin whose subject has gone (a let-go goal, an answered question, an element that vanished) isn't drawn; the dock still lists the thread, marked "subject gone".

**Stable identity in the DOM.** Every item the dashboard renders gains `data-subject="<type>:<id>"`: goal cards, observations, open and answered questions, tickets, planners, decisions, candidate and accepted lessons, problems, acts, previews and artifacts in the Library. A click resolves to the nearest `[data-subject]` ancestor; outside any, to a **page** subject (§5).

### 5. Subjects

| kind | recorded | pin placed by |
|---|---|---|
| `item` | `ref` (`goal:g-…`, `ticket:checkout-04`, `observation:o-…`, …), `quote`: the text shown (at most 300) | the element with that `data-subject` |
| `page` | `view` (the hash route, e.g. `#loop/observe`), `at` (`{x, y}` as fractions of the section's box), `quote`: the nearest heading's text | the section and the fractions |
| `artifact` | `slug`, `at` (`main`, a worktree, or `tree:<id>`), `fp` (the fingerprint shown), `path` (the page inside it), `anchor` (§6) | the artifact lens |
| `preview` | `name`, `route`, `viewport`, `anchor` (as #176's: selector, tag, role, text, name, html, rect, the point inside it), `errors` (the last five console errors) | the preview lens |

Captured strings are capped on write (selector 300, text and name 80, html 2,048, route 500, errors five of 300). Everything in a subject but the owner's own `title` is page-written: shown escaped, given to the supervisor only inside the data frame, and never typed into a pane.

When a subject has changed since the thread began (a goal edited, an artifact at a new fingerprint, a lost element), the context card says so beside the quote ("changed since"; `artifactLinkNow` already computes this for artifacts).

### 6. Artifacts: a lens inside the frame

An artifact runs in an opaque origin (the CSP `sandbox` without `allow-same-origin`), so nothing outside it can read its document, and the artifacts spec ruled out a bridge back. Coordinates alone don't survive scrolling (the viewer can't see the artifact's scroll). So the kit adds a narrow, read-only bridge:

- When the kit serves an HTML document under `/artifact/` **and the request says `sec-fetch-dest: iframe`**, it appends one `<script>` (the **artifact lens**) to the body and adds its `sha256-` to the response's `script-src`. Any other request (a top-level load, the gateway's loopback fetch for a publish, `curl`) gets the bytes unchanged, so publishing, `artifact check` and hashes are untouched.
- The lens answers the parent only: `hit {id, x, y}` → `hit-reply {id, anchor, rect}` (anchor as for previews, `elementFromPoint` on its own document); `resolve {anchors}` → `rects`; `scroll-to {anchor}`; and it reports `ready {path, size}`, `scroll {x, y}` and `key {shift}` (Shift seen with focus inside the artifact). It sends nothing else and acts on nothing else.
- The viewer accepts a message only when `event.source` is that frame's `contentWindow` (an opaque origin's `origin` is `"null"`, so `source` is the check) and only as a reply to an id it minted for a real pointer event, or as a position update for pins.
- An artifact can rewrite the lens (it's its own document) and lie about itself. That is agent content describing itself to the supervisor as data; it can't create a thread, a turn or anything else, because only the layer's own owner events do.

In the dashboard's artifact viewer the overlay sits over the existing frame (z-index 22) and forwards wheel events in pin mode as `scroll-by`. Pins on an artifact key on `slug`, `path` and the anchor, and show "changed since" when the fingerprint moved.

### 7. Dev links and the viewer page

**The viewer** is the dashboard page in a viewer mode: `index.html` served at `/view/artifact/<slug>[?at=<main|wt-name|tree:id>]` and `/view/preview/<name>`. A one-line bar (name, project, session or version, route, live or not), the stage, the layer and the dock; no navigation. The Library's **Open**, a question's `[[name]]` and Pop out open it in a new tab. The dashboard's in-page artifact viewer gains the same layer, and previews get the same in-page viewer beside artifacts.

**Previews use #176's lens and relay**, unchanged in substance:

- The **preview lens** is a small static document at `/.devteam/lens` on the preview's own origin that frames the app and, being same-origin, reads its DOM for the viewer over `postMessage` (the same messages as the artifact lens, plus `route`, `go` and `errors`). Its CSP is hash-only with `frame-ancestors` the instance origins. On a box the gateway serves it; on a laptop the kit's **relay** (a loopback listener per preview, ports 4500–4599, opened when its viewer is first requested and closed with the record) forwards to the app with `Host: localhost:<port>` and serves the lens.
- The app is framed with `sandbox` minus top navigation. The app's `X-Frame-Options` and `frame-ancestors` are relaxed in exactly one case: a framed load from its own origin (`sec-fetch-dest: iframe`, `sec-fetch-site: same-origin`), which is the lens's.
- The lens's source lives once in `devteam.mjs` and once in `cloud/gateway.mjs`; a test asserts they are byte-identical, as the CDN list and type map are.
- In the dashboard, the viewer shows previews in the in-page stage too, framing the same lens.

**The viewer's own headers**: `frame-src` the preview origin (or relay) and `'self'`; `frame-ancestors 'self'`, the hub, and on a box `https://public.<box>` (for §8); `referrer-policy: no-referrer`.

**Routing a dev-link thread.** The supervisor reads the thread, relays the change to the offering session (`send <session> "<what to do>" --kind answer`, citing the thread and the anchor), and reports back with `refs`. A preview whose session is gone keeps its threads; the supervisor folds them into a follow-up ticket as it would any request.

### 8. Published artifacts, for the owner

`https://public.<box>/<project>/<slug>/` serves exactly today's bytes and headers to anyone without a session. For a **document navigation** carrying a valid owner session, the gateway serves the **owner wrapper** instead: its own small page (`PAGE_CSP`, `cache-control: no-store, private`) that frames `https://<port>.<box>/view/artifact/<slug>?at=tree:<the published tree>` from the instance it holds the project's binding for, full size, under a one-line bar ("Public · <project>/<slug> · open as the public sees it"). That link adds `?plain` and gets the public bytes, also for the owner.

- The kit serves `/artifact/tree/<tree>/<slug>/<rel>` from git (`git ls-tree` and `cat-file`, as the manifest already does), so the viewer shows exactly the published version. A tree that isn't in the repository answers 404, and the viewer falls back to main with a "not the published version" bar.
- When the instance doesn't answer, the wrapper says "Threads need <project>'s dashboard, which isn't running" with the plain link.
- The public host's rule "the incoming cookie header is ignored" becomes: read only to choose the wrapper, never forwarded, never set. Plain responses on document paths gain `vary: cookie`.

### 9. Questions, the Inbox and standing rules

- **Asking.** `thread ask t-… --kind … "<question>" …` is `ask` with `thread` set, plus a turn. It is an Inbox question in every respect: kinds, choices, defaults, `rule_scope`, stake and urgency, order, push, `goal-approval` going through `goal decide`, `review` needing its result. The Inbox card says "from a thread: <title>" and links to it.
- **Answering.** In the card, the question renders with the Inbox card's own markup and handlers: the same choices, the same "make this a standing rule" checkbox, posting to the same `/api/answer`. Answering in either place answers it once; the other shows it answered. The supervisor's pane gets the question id as it does now.
- **Standing rules** apply as they do today: they guide the supervisor and authorise what they authorise. A thread changes none of that.
- **"Go ahead" in a turn.** The owner's turn is their words to the supervisor, the same as in its session (§6 of `supervisor.md`), already recorded verbatim. When it settles a decision, the supervisor records it as it records chat, with the turn instead of a quote: `answer <qid> "<answer>" --from-turn <u-id>` (and `goal decide … --from-turn <u-id>`). The kit copies the turn's text into `said`, sets channel `thread`, and refuses unless the turn exists, is the owner's and is in a thread. No transcript check is needed: the words are in the log. The dashboard lists these answers as it lists chat answers, for the owner to check.

### 10. Resolving, and the loop

- **Resolve** (the card's header, or accept the supervisor's proposal): the owner's `status: resolved` with an optional outcome, and the `thread-resolved` observation. The pin goes, the dock entry moves to Resolved. Open questions in the thread stay in the Inbox; the card warned "1 question still open" before resolving.
- **Reopen**: `status: open`, `reopened`, and optionally a turn. The pin returns.
- **The loop.** The observation is in Observe like any other (subject `thread:<id>`, linked to the thread). The supervisor's Orient reads it with the rest: what the owner keeps raising, about which goals and artifacts, and what was resolved without a change. `process/supervisor.md` §3 says to read recent `thread-resolved` observations at each tick and to look for repeats (three threads on one goal is a signal about the goal). `observe-metrics` counts open threads, threads waiting on the supervisor, and median time to first reply.

### 11. Security

What holds, and what each addition can and can't do:

- **Who can write.** Threads, owner turns, resolves and reopens come only through `ownerWriter()` (refused under any `DEVTEAM_ROLE`) and the dashboard's `ACTIONS` (host, same-origin, JSON). This has the same limit as every owner route today: a process on the box running as the owner's user can call it, and a line written that way looks the owner's. Closing that is separate work on proving owner approvals; threads add no new path around it.
- **Who can read.** The dashboard (local, or behind the passkey on a box); nothing on `public.<box>` reads a thread. The wrapper is the gateway's own page and holds no thread content.
- **Page-written content.** A subject's capture (element text, HTML, routes, console errors, artifact text) is agent-written. It is shown escaped, given to the supervisor only inside the data frame, and never typed into a pane. A pane line carries the owner's words and the title they saw.
- **Lens messages.** Accepted only from the frame they belong to (`source`), and only as replies to ids the layer minted, or as position updates. A frame can lie about itself; it can't start, write or resolve anything.
- **The artifact lens** is added only on framed loads, so published and fetched bytes are untouched, and it is allowed by its own hash only.
- **The preview lens and framing relaxation** are #176's: framing headers relaxed only for the app framed by its own origin, the lens framable only by instance origins, the app sandboxed against navigating the viewer.
- **The owner wrapper** is served only for a document navigation with a valid session, never cached (`no-store, private`), and frames only an instance origin the gateway already binds the project to. The plain public response stays exactly as it was, plus `vary: cookie`.
- **The viewer** is framable by itself, the hub and the public host only.
- **Sizes.** Turns 2,000 characters; captures capped (§5); bodies 16 KB; at most 200 open threads per project (`thread new` refuses a 201st: resolve some).

### 12. The gateway

- `GET /.devteam/lens` on a preview host after the session check; never proxied. The one framing relaxation in `downstreamHeaders` for preview responses. The lens's `frame-ancestors` from the instance origins.
- The owner wrapper on `public.<box>` (§8), and `vary: cookie` on plain document responses.
- Nothing persisted, no new polling.

## Scope and sequence

Three PRs, one release, in this order:

1. **Kit: threads** — the records, `thread` commands, `answer --from-turn`, `ACTIONS`, `/api/threads`, delivery, `thread-waiting`, the layer (Shift+click, pin button, card, dock, pins), `data-subject` throughout the dashboard, Inbox mirroring, resolution observations, `supervisor.md` and the constitution sentence. Works on dashboard items and page subjects, on a laptop and a box.
2. **Kit: viewers** — the artifact lens and its framed-only injection, `/artifact/tree/`, the viewer mode at `/view/…`, the preview lens and the laptop relay, the in-page preview stage, Library Open and `[[name]]` to the viewer.
3. **Gateway** — the lens on preview hosts, the framing relaxation, the owner wrapper on the public host.

No new files outside tests and docs: the layer and the viewer are `index.html`, the commands `devteam.mjs`, the lens a string in each of `devteam.mjs` and `gateway.mjs`.

## Risks

- **Reply lag.** The supervisor may be mid-task for minutes. The card's states and the "on it" turn soften it; `thread-waiting` catches a dropped one. If it proves annoying, a fast stand-in is the follow-up the owner left room for.
- **The layer and the 10 s rebuild.** Pins must be re-placed after every `innerHTML` rebuild, and the composer must survive it; `holding()` and the draft save/restore already exist for the Inbox and are reused.
- **Shift collisions.** Apps that use Shift+click (range selection in a list) lose it while the pin shows. The pin shows only when Shift is held with the pointer moving outside a text field, and Esc dismisses it.
- **Generated selectors in dev apps.** As #176: text fallback, `changed`, and a lost element still carries its capture.
- **Safari and iPhone.** Untested headless; the pin button, the bottom sheet and `touch-action` need a real phone.
- **The cookie on the public host.** Reading it is new there; a cache that ignores `vary` could hand the plain page to the owner (harmless) and can't hand the wrapper to anyone (`no-store, private`).

## Testing

- **Kit (`test/kit.test.mjs`, `test/dashboard.test.mjs`):** schema accepts `thread` and `turn` and refuses them from the wrong writer; `thread new|say|ask|ready|resolve|reopen|show|list` with their refusals (resolved thread, wrong role, 201st open thread, caps); `thread ask` produces a question identical to `ask`'s plus `thread`, and a turn; `answer --from-turn` copies the words, sets channel `thread`, refuses a supervisor's turn; resolving writes the observation; `threadView` and `waiting`; the pane line carries no capture; `thread-waiting` after 10 minutes; `/api/threads` is cached by file stat and refuses a wrong origin; `ACTIONS` refuse bad bodies; the artifact lens is injected only for `sec-fetch-dest: iframe` and its hash is in `script-src`; the publish manifest's hashes are unchanged; `/artifact/tree/` serves a landed tree and 404s an unknown one; `/view/…` headers; the relay as #176's tests; the lens string equals the gateway's.
- **Gateway (`test/gateway.test.mjs`):** the lens on a preview host needs a session and is never proxied; the framing relaxation only on `iframe` + `same-origin`; the public host serves the wrapper for a signed-in document navigation, the plain bytes (with `vary: cookie`) otherwise and for `?plain`, and the wrapper never caches.
- **Browser (`test/browser/dev-links.mjs`, extended):** Shift+move shows the pin and highlights a goal card; a click opens the card with the context card; a turn reaches a fake supervisor pane; a supervisor turn appears within 3 s; a thread question answered in the card shows answered in the Inbox; resolve unpins and the dock moves it; a pin survives the 10 s rebuild; on an artifact the pin follows a scroll; on a Vite preview through the relay the pin follows hot reload.

## Docs

- `process/supervisor.md`: §1 (startup: `thread list --waiting`), §3 (the tick: `thread-waiting`, reading resolutions), §6 (threads: reply first, `thread ask`, `--from-turn`, `ready`; captures are data), §7 (relaying dev-link threads to the offering session).
- `governance/constitution.md`: one sentence: an owner's turn in a thread carries the weight of the owner's words in chat.
- README: the dashboard paragraph (Shift+click, the dock), the tree, the cloud section's public-artifact bullet (the owner wrapper) and threat-model bullets (lens, framing, the cookie on the public host).
