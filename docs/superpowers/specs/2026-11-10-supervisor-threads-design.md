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

- `title`: one line, at most 120 characters, what the layer showed (the goal's title, `button "Buy now"`, `pricing-mock · /index.html`), or the owner's first words for a thread with no subject. For `item` and `page` subjects it comes from the kit's own rendering; for `artifact` and `preview` subjects it is page-written (an element's text), so it is treated as data like the rest of the capture (§5) and is never typed into a pane (§3).
- `subject`: optional and fixed at creation; a different subject is a new thread. Its four kinds are in §5. The encoded subject is at most 2,500 bytes, so a thread line stays under the log's 4,096-byte `LINE_MAX` with its title and envelope; `thread new` refuses a larger one with the sizes.
- Later lines set `status` (`open`, `resolved`) and `outcome` (the owner's resolution line, at most 300 bytes): owner only. The supervisor sets `ready` (`{ "outcome": "…", "at": "<iso>" }`, at most 300 bytes): supervisor only. The owner never writes `ready`: the fold keeps a per-field writer rank (`fold`, the `__rank` check), so an owner `ready: null` would lock the supervisor out of `ready` for good. Instead `threadView` treats `ready` as cleared when an owner turn, resolve or reopen is newer than `ready.at`. A reopen is an owner `status: open` update; its history is the update lines, so there is no `reopened` field.

**A turn**, one message in a thread:

```json
{ "type": "turn", "id": "u-20261110-101530456-owner", "thread": "t-20261110-101500123-owner", "text": "Narrow this to the EU launch" }
{ "type": "turn", "id": "u-20261110-101720789-supervisor", "thread": "t-…", "text": "Done: the goal's measure is EU orders now.",
  "refs": ["goal:g-20261101-090000000-supervisor", "act:a-20261110-101719000-supervisor"] }
```

- `text`: at most 2,000 **bytes** UTF-8 (2,000 ASCII characters; fewer for CJK or emoji; the composer counts bytes), multi-line allowed.
- `refs` (supervisor turns): at most 8, each `<type>:<id>` (`goal:g-…`, `ticket:checkout-04`, `act:a-…`) at most 120 bytes; the card renders each as a link ("goal changed", "ticket checkout-04 opened").
- `question` (supervisor turns): the id of a question this turn asks (§9). A turn that asks nothing leaves it out; it is never `null`.
- A turn is refused for a thread that doesn't exist or is resolved (the owner reopens it first, or a supervisor turn on a resolved thread is refused with that reason).

**A question gains `thread`** (optional, a `t-` id): the thread it was asked in. `x-authority`: supervisor, on create.

**An answer gains `--from-turn <u-id>`** (§9): the owner's words come from the turn, not a chat quote. The envelope's `channel` enum (`cli | dashboard | chat`) gains `thread`; `checkLine`'s chat-shape rule (a chat answer must carry `said`) applies to `thread` too; `chatQuotesNotFound` stays `chat`-only, deliberately, because a turn's words are already in the log; the dashboard's `CHANNEL_WORDS` and the chat label learn `thread` ("in a thread").

**A resolution is also an observation** (§10): the owner already creates observations; this one has `source: "owner"`, `kind: "thread-resolved"`, `subject: "thread:<t-id>"`, `detail` the outcome (or "resolved" with none), and `refs` bare ids as observation `refs` are elsewhere (the thread's id and the subject's id: `g-…`, `checkout-04`, an artifact slug, a preview name).

**Ids.** `data-subject` and `subject.ref` use `<type>:<id>` throughout (`goal:g-…`, `ticket:checkout-04`, `artifact:pricing-mock`); observation `refs` use bare ids.

Folding: `threadView` (beside `questionView`) builds `{ id, title, subject, status, outcome, ready, turns: [...], questions: [...], waiting }`, where `waiting` is `owner` when the newest turn is the supervisor's or there is none (the owner's move), `supervisor` when it is the owner's.

**Older kits.** `parseLines` reports an unknown type as "not a log line", so an older kit's `log-check` and `merge --chore log` fail on a log that holds threads. The release note says: update every checkout's kit (`devteam-sync`) before using threads; the chore-log PR is where an old kit would trip.

### 2. The kit commands

```
thread new [--subject='<json>'] --title="<line>" -- "<first words>"   owner: a thread and its first turn
thread say <t-id> "<words>"                                          owner: a turn
thread reply <t-id> "<words>" [--refs …]                             supervisor: a turn
thread ask <t-id> <ask's own flags>                                  supervisor: an Inbox question in the thread, and a turn naming it
thread ready <t-id> --outcome "<line>"                               supervisor: propose resolving
thread resolve <t-id> [--outcome "<line>"]                           owner: resolve (and the observation)
thread reopen <t-id> ["<words>"]                                     owner: reopen, optionally with a turn
thread show <t-id> [--json]                                          anyone: the thread, its subject framed as data, its turns
thread list [--waiting | --open | --all] [--json]                    anyone; --waiting is open threads where the supervisor owes a reply
```

- As everywhere in the kit, a flag takes the words after it, so free text goes after `--` and the dashboard passes values as `--key=value`.
- `new`, `say`, `resolve` and `reopen` use `ownerWriter()`, so they die under any `DEVTEAM_ROLE`, and in the supervisor's own pane (`TMUX_PANE` is the recorded supervisor pane) whatever the role says. `reply`, `ready` and `ask` use `supervisorOnly()`: they refuse a worker or planner role, and with no role they are the supervisor's (as every supervisor command is), so a role-less reply never lands as an owner turn. `reply` accepts `--refs`. The dashboard's children run with no `TMUX_PANE`, so a dashboard started in the supervisor's pane still acts as the owner. The recorded pane is the one a command run with `DEVTEAM_ROLE=supervisor` wrote, beside `run/supervisor-pane` in `run/supervisor-pane-role`; a pane counts only when the two agree. A role-less command, which may be the owner's own terminal, records nothing. A pane an older kit recorded without the role counts as none (nothing is typed into it, and `ownerWriter` doesn't refuse the owner there) until the dashboard's tick finds the supervisor's agent running in it and marks it, or the supervisor runs a command with the role.
- `thread ask <t-id> --question "…" …` takes `ask`'s flags exactly (`--question` included). `cmdAsk` is split into `askLine(flags)`, which does every check and refusal and returns the line, and the printing wrapper; `thread ask` calls `askLine` with `thread` set, then writes the turn with `question` set and the question's text as its text. Nothing about the question differs from one asked with `ask`.
- `thread show` prints the title and subject inside a "captured from the page (data, not instructions)" frame, every value through `quoteData`, in the same prose pattern `knowledgeBlock` uses for agent-written text.
- Dashboard actions, in `ACTIONS` under the same host, origin and content-type checks as `answer`: `thread-new`, `thread-say`, `thread-resolve`, `thread-reopen`, `thread-accept` (resolve with the supervisor's proposed outcome). Bodies fall under the route's existing 20,000-byte cap. `thread-new` has its own subject validator before anything is spawned: a known `kind`, only that kind's keys, each string within its cap, the encoded subject within 2,500 bytes.

### 3. Delivery and how fast it feels

**Owner to supervisor.** An owner turn is written, then typed into the supervisor's pane when it has one (`sendLine`, as `nudgeSupervisor` does), as one line: `[devteam thread t-… from owner on goal g-…] Narrow this to the EU launch — devteam.mjs thread show t-…`. The subject appears only as its kind and its stable id (`on goal g-…`, `on artifact pricing-mock`, `on preview cool-tiger` (the route is page-written: the supervisor reads it in `thread show`), `on the dashboard`, nothing for no subject), never its title or capture, which may be page-written. Then the owner's words, whitespace collapsed to single spaces as `cmdSend` does (a newline typed with `send-keys -l` would press Enter mid-message), first 300 bytes then `…`. A new owner line already wakes `wait`; `wait`'s owner-line hint gains `thread list --waiting` when the new line is a turn.

**Supervisor to owner.** `thread reply` and `thread ask` write the log; nothing else. The supervisor's prompt (`process/supervisor.md` §6) says: reply in the thread before doing the work when the work takes more than a turn ("on it, opening a ticket"), and again with `--refs` when it's done.

**The card's states**, from the log and the kit's knowledge of the pane:

| state | shown |
|---|---|
| owner turn written, pane typed | "sent" |
| written, no pane (the supervisor is waiting, parked, or not running) | "sent; the supervisor will read it when it next checks" |
| supervisor turn newer than the owner's | the reply |
| owner turn older than 10 minutes with no reply and the supervisor running | "the supervisor hasn't replied yet" |

The supervisor's tick gains **`thread-waiting`** (medium): an open thread waiting on it for more than 10 minutes; its fix is `thread list --waiting`. At startup it runs `thread list --waiting` beside `knowledge --status accepted`.

**Fast reads.** `/api/data` spawns a slow child, and `readLog()` can't be reused in the server process: its cache is invalidated only by `appendLog` (which the server never calls) and `logFileText` shells out to `git show`. So `GET /api/threads` has its own reader over both copies of the log (`run/log/*.jsonl`, written live, and the checkout's `project/log/*.jsonl`, which after a machine move or a dead laptop is the only copy until each file's next write), deduplicated by line id, through `parseLines` and `integrity`, with a cache keyed by each file's size and mtime, so a repeat read is a few `stat` calls. It folds threads, turns and questions carrying `thread`. Like `/public-manifest/`, it is refused when `sec-fetch-site` is present and not `same-origin` (a GET carries no `Origin`). The open card polls it every 2 s while visible; otherwise the layer refreshes when `/api/data`'s 10 s tick redraws. Polling, as everything in the dashboard is.

### 4. The layer

One piece of `dashboard/index.html`, used by the dashboard and by the viewer (§7): the cursor, the highlight, the card, the pins and the dock. It lives outside the region the 10 s refresh rebuilds, and re-places pins from the redraw itself (a hook at the end of `drawOrHold`), not on a timer.

**Shift+click on the dashboard.** Shift is held and the pointer moves: the cursor becomes the pin (a drawn 28 px teardrop in the accent colour with a white edge, `cursor: none` beneath it, from #176) and the subject under it is highlighted with a chip naming it. Shift pressed while focus is in a text field shows nothing until the pointer moves outside it, so capitals don't summon it. A click while it shows starts a thread on that subject and is consumed: the layer listens on `window` in the capture phase for `pointerdown`, `mousedown` and `click`, and calls `preventDefault` and `stopImmediatePropagation`. That stops the browser's own Shift+click (a new window, extending a selection) and the page's handlers, including the dashboard's capture-phase `pointerdown` that sets `PRESSED` and would hold the refresh. Releasing Shift or Esc puts the normal cursor back. Clicking a pin opens its thread without Shift.

**Shift+click over a frame** (an artifact, a preview). The parent sees no `pointermove` over a frame and no key while the frame has focus, so:

1. Shift down, seen by the parent or reported by the frame's lens (`key {key, shift: true}`, taken only while the frame has the keyboard; the preview lens listens on the app frame's window in the capture phase and re-attaches after every load), raises the overlay over the frame (`pointer-events: auto`).
2. The overlay's `pointermove` sends `hit {id, x, y}` to the lens, at most once per animation frame, under an id minted for that pointer event, and draws the highlight from the `hit-reply`. A question is answered once: its id is let go of as its reply is taken, so a page that answers it again is dropped. An anchor is believed only when its rect holds the point asked about (a few pixels' slack); one without a rect, or elsewhere, is no anchor, and the thread keeps the point alone.
3. A click on the overlay starts a thread on the latest `hit-reply`. With no reply within 150 ms (no lens, an old kit, a frame that ignores it) it falls back to coordinates only: an `artifact` or `preview` subject with `point` (`{x, y}` in frame coordinates) and no `anchor`, which the pin draws in frame coordinates.
4. The parent's own evidence lowers the overlay again (`pointer-events: none`), and the frame gets its clicks back: its own Shift up, blur or Esc, or its pointer moving or pressing without Shift. A press without Shift on an overlay the page raised lowers it at the press, but that press and its click are consumed: the press landed on the overlay, in the parent, so the frame never saw it and can't be handed it, and the owner's next click reaches the page. A `key` from the frame only ever raises it, since the page's own scripts can send the same message at any time: a "Shift up" or an Esc from it lowers nothing while the owner may be holding Shift. An Esc from the frame ends pin mode only.

**The pin button.** In the dock's header: a sticky pin mode for touch devices (`pointer: coarse`) and for a long pass. Touch places a pin under the finger with the highlight following; lifting drops it. Esc or the button again leaves the mode.

**The card.** Opens beside the pin, flipped to stay on screen; a bottom sheet under 640 px. At the top, the **context card**: one tight line naming the subject (kind icon, title, where), expandable to the capture. Then the turns, newest at the bottom, the supervisor's with its `refs` as links and any question rendered with the Inbox card's own markup and controls (§9). The thread's copy of a question card carries `id="t-q-<id>"`, not `q-<id>`, and the answer handlers find their card from the event target (`closest('[data-qcard]')`, a new attribute on both copies of the card) rather than `getElementById`, so the Inbox copy and the thread copy never collide. Then the composer (Enter sends, Shift+Enter is a new line; the draft is kept in `localStorage` per thread as review drafts are). The header has Resolve, and when the supervisor proposed it, a banner: "Ready to resolve: <outcome>" with **Resolve** and **Not yet** (an owner turn, which clears `ready`). One card is open at a time; opening another closes the first.

**The dock.** Bottom right, collapsed to a pill ("Threads · 3 ●") until opened. Open: every open thread, newest activity first, each with its number, title, where its subject is ("Goals", "pricing-mock", "cool-tiger /checkout", "no subject") and a dot when the supervisor replied since the owner last opened it (`localStorage`). Clicking one goes to its subject (the route, the scroll, the artifact or preview viewer) and opens the card; a thread with no subject, or a subject not on any page now, opens its card in the dock itself. **New thread** starts one with no subject. **Resolved** at the bottom lists the last 50 resolved threads, each reopenable.

**Pins.** A small numbered disc at the subject's top right corner (dashboard items) or at the anchor's point (§6, §7), only for open threads whose subject is on screen. A subject with several threads shows one pin with a count. A pin whose subject has gone (a let-go goal, an answered question, an element that vanished) isn't drawn; the dock still lists the thread, marked "subject gone".

**Stable identity in the DOM.** Every item the dashboard renders gains `data-subject="<type>:<id>"`: goal cards, observations, open and answered questions, tickets, planners, decisions, candidate and accepted lessons, problems, acts, previews and artifacts in the Library. A click resolves to the nearest `[data-subject]` ancestor; outside any but inside one of the dashboard's sections, to a **page** subject (§5); outside the sections (the drawer, the sidebar, a bar) to nothing: no pin shows, and the click is the page's own.

### 5. Subjects

| kind | recorded | pin placed by |
|---|---|---|
| `item` | `ref` (`goal:g-…`, `ticket:checkout-04`, `observation:o-…`, …), `quote`: the text shown (at most 300) | the element with that `data-subject` |
| `page` | `view` (the hash route, e.g. `#loop/observe`), `at` (`{x, y}` as fractions of the section's box), `quote`: the nearest heading's text | the section and the fractions |
| `artifact` | `slug`, `at` (`main`, a worktree, or `tree:<id>`), `fp` (the fingerprint shown), `path` (the page inside it), `anchor` (§6) | the artifact lens |
| `preview` | `name`, `route`, `viewport`, `anchor` (as #176's: selector, tag, role, text, name, html, rect, the point inside it), `errors` (the last three console errors) | the preview lens |

Captured strings are capped on write in bytes (selector 200, text and name 80, html 1,024 with children past the first level collapsed to `…`, route 300, errors three of 200, quote 300), and the whole encoded subject at 2,500 bytes (§1). The layer trims to fit before sending (html first, then errors). For `artifact` and `preview` subjects everything, the title included, is page-written; for `item` and `page` subjects the title and quote are the kit's own rendering of log content, which is itself agent-written. So every subject is shown escaped, given to the supervisor only inside the data frame, and never typed into a pane.

When a subject has changed since the thread began (a goal edited, an artifact at a new fingerprint, a lost element), the context card says so beside the quote ("changed since"). `artifactLinkNow` computes this for `main` and `wt/`; it is extended to `tree:<id>` (a published version never changes, so "changed since" there means main has moved on from it).

### 6. Artifacts: a lens inside the frame

An artifact runs in an opaque origin (the CSP `sandbox` without `allow-same-origin`), so nothing outside it can read its document, and the artifacts spec ruled out a bridge back. Coordinates alone don't survive scrolling (the viewer can't see the artifact's scroll). So the kit adds a narrow, read-only bridge:

- When the kit serves an HTML document under `/artifact/` **and the request says `sec-fetch-dest: iframe`**, it appends one `<script>` (the **artifact lens**) at the very end of the document, after `</html>` if there is one, where the parser takes it into the body; nothing of the artifact is parsed for it, and a page that ends inside an unclosed `<script>`, `<style>`, `<textarea>`, `<title>`, a comment or the like swallows it, so its pins fall back to points. The response's CSP is **not** changed: the artifact policy's `script-src` already has `'unsafe-inline'`, which admits it, and adding a hash would make browsers ignore `'unsafe-inline'` and block every artifact's own inline scripts. Any other request (a top-level load, the gateway's loopback fetch for a publish, `curl`) gets the bytes unchanged, so publishing, `artifact check` and hashes are untouched.
- The lens speaks the preview lens's protocol (§7), `{ lens: 1, type, … }` both ways. From the parent: `hello`, `hit {id, x, y}`, `resolve {id, anchors: [{key, anchor}]}` (each key a thread's id, never words), `scroll-by {dx, dy, x, y}` (wheel events from the overlay in pin mode) and `scroll-to {anchor}`. From the lens: `ready {path, title, viewport}`, `hit-reply {id, anchor, rect}` (anchor as for previews, `elementFromPoint` on its own document), `rects {id?, rects}` (after a `resolve`, sent again by itself whenever a watched anchor moves: a scroll, a resize, a DOM change, and once a second as a backstop) and `key {key, shift}` (Shift or Escape seen with the focus inside the artifact, and nothing before the parent has said `hello`). It sends nothing else and acts on nothing else. It replies to `location.ancestorOrigins[0]` where the browser gives it, else `'*'`.
- **The box's capability stays out of it.** On a box the frame is served under `/c/<capability>/artifact/…`, and that capability is a live bearer token for the owner's session. The lens tells the page's path from its artifact segment on and cuts the token from every string it sends (as written, percent-encoded, JSON- or `\u`-escaped, or as entities); the dashboard cuts the same from what it takes in; and the kit strips it from every string of a saved thread's subject and title as a backstop (`[link removed]`; the owner's words still save). A hostile page can speak as its lens, so this is a backstop, not a wall.
- The parent posts to an opaque-origin frame with target origin `'*'`, so the artifact's own scripts can see those messages too. They carry only coordinates, anchors and ids, never the owner's words.
- The viewer accepts a message only when `event.source` is that frame's `contentWindow` (an opaque origin's `origin` is `"null"`, so `source` is the check) and only as a reply to an id it minted for a real pointer event (once: see §4), or as a position update for pins. A `key` is taken only while the frame has the keyboard.
- An artifact can rewrite the lens (it's its own document) and lie about itself. That is agent content describing itself to the supervisor as data; it can't create a thread, a turn or anything else, because only the layer's own owner events do.

In the dashboard's artifact viewer the overlay sits over the existing frame (z-index 22) and forwards wheel events in pin mode as `scroll-by`. Pins on an artifact key on `slug`, `path` and the anchor, and show "changed since" when the fingerprint moved.

### 7. Dev links and the viewer page

**The viewer** is the dashboard page in a viewer mode: `index.html` served at `/view/artifact/<slug>[?at=<main|wt-name|tree:id>]` and `/view/preview/<name>`. A one-line bar (name, project, session or version, route, live or not), the stage, the layer and the dock; no navigation. Viewer mode skips `route()`, the tab memory and `render()`, and never polls `/api/data`. It polls `/api/threads` (§3) and `/api/hello` (for the preview's state) only, and asks `/api/view` once for an artifact's title and fingerprint (404 when nothing is there at that version, and for a draft or a published version the viewer then shows main's, with a note saying so; a failed or timed-out read is a 500, which the viewer says could not be read, keeping the version asked for, and never takes for nothing-there), so a dozen open viewer tabs cost a dozen cheap reads. The Library's **Open**, a question's `[[name]]` and Pop out open it in a new tab. The dashboard's in-page artifact viewer gains the same layer, and previews get the same in-page viewer beside artifacts.

**Previews use #176's lens and relay**, unchanged in substance:

- The **preview lens** is a small static document at `/.devteam/lens` on the preview's own origin that frames the app and, being same-origin, reads its DOM for the viewer over `postMessage` (the same messages as the artifact lens, plus `route`, `go` and `errors`). Its CSP is hash-only with `frame-ancestors` the hub and the instance origins (every ancestor is checked, and the in-page viewer is hub → dashboard → lens). That policy is the same bytes on every preview's name, because the kit's relay serves the lens too and can't know the box's origins, so any instance name may frame the lens; the app's policy below is what ties it to one instance. On a box the gateway serves it; on a laptop the kit's **relay** (a loopback listener per preview, ports 4800–4899, opened only by the dashboard's own `/api/view` ask (never by a GET of the viewer's address) and closed with the record) forwards to the app with `Host: localhost:<port>` and serves the lens.
- The app is framed with `sandbox` minus top navigation. The app's `X-Frame-Options` and `frame-ancestors` are relaxed in exactly one case: a framed load from its own origin (`sec-fetch-dest: iframe`, `sec-fetch-site: same-origin`), which is the lens's. There the app's `frame-ancestors` becomes `'self'`, the hub and the origin of the one instance whose hello lists the preview: `'self'` alone would refuse the app inside its own lens, whose parents are the dashboard and the hub. A lens framed by any other instance's page gets an empty frame. An app that said nothing of frames by policy (`X-Frame-Options` alone, or no framing header at all, a dev server's default) gets that same `frame-ancestors` as a policy of its own, on that load only. A name two instances list, a dev port two instances list (every name on it), or a name the hub doesn't list, is never proxied, so it never reaches the relaxation. The hub's list is agent-written, so the app can be read through its lens by a page on any instance name that lists the dev server's port as a preview of its own; the shared-port rule means that can't be a port a real instance lists, and a dev port that no instance lists can still be claimed.
- The lens's source lives once in `devteam.mjs` and once in `cloud/gateway.mjs`; a test asserts they are byte-identical, as the CDN list and type map are.
- In the dashboard, the viewer shows previews in the in-page stage too, framing the same lens.

**The viewer's own headers**: `frame-src` the preview origin (or relay) and `'self'`; `frame-ancestors 'self'` and the hub; `referrer-policy: no-referrer`. The kit doesn't know the public host; the gateway adds it (§8, §12).

**Routing a dev-link thread.** The supervisor reads the thread, relays the change to the offering session (`send <session> "<what to do>" --kind answer`, citing the thread and the anchor), and reports back with `refs`. A preview whose session is gone keeps its threads; the supervisor folds them into a follow-up ticket as it would any request.

### 8. Published artifacts, for the owner

`https://public.<box>/<project>/<slug>/` serves exactly today's bytes to anyone without a session, under today's headers plus, on a page's index, `vary` and an opener policy (below). For a request with **`sec-fetch-dest: document`** (a top-level navigation; `navigating()`'s `sec-fetch-mode: navigate` would also match frame loads) carrying a valid owner session, the gateway serves the **owner wrapper** instead. It is its own small page under a policy of its own, `WRAP_CSP`: `default-src 'none'; style-src 'unsafe-inline'; frame-src https://<port>.<box>; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` (no script and nothing to connect to, which `PAGE_CSP` would admit), and `cache-control: no-store, private`. It frames `https://<port>.<box>/view/artifact/<slug>?at=tree:<the published tree>&w=<expiry>.<mac>` from the instance it holds the project's binding for, full size (only an artifact's index page is wrapped: the viewer URL carries no page path), under a one-line bar ("Public · <project>/<slug> · open as the public sees it"). That link adds `?plain` and gets the public bytes, also for the owner. Without fetch metadata (an old browser), the plain bytes.

- **Failure falls back to plain.** `servePublic` runs today before any session code, inside a branch that turns errors into a 5xx. The session check is a separate step that can only choose the wrapper: a bad cookie or a missing binding serves the plain bytes. An unreadable public store is a 503 for everyone, as it is today, since the plain bytes come from the same store.
- **The kit serves `/artifact/tree/<tree>/<slug>/<rel>` from git** (`git ls-tree` and `cat-file`, as the manifest already does), so the viewer shows exactly the published version. Only an artifact folder's tree is served (a tree with an `artifact.json` at its top); a commit's or the root tree's id would name any committed file. And only under the slug whose folder it was on main: main's tree for that folder now, or main's history of it (`git log --raw -t -m --first-parent -- <artifacts>/<slug>`, which walks only the commits that touch it, a merge against main's previous state). Another artifact's tree under this slug would show its files under this one's name, in the bar and in a thread's subject. A yes is remembered (a tree id never changes and main's history only grows); a no is asked again. A shallow clone's history stops short, so an older version there is no one's. A tree that isn't one, or isn't this slug's, answers 404, and the viewer falls back to main with a "not the published version" bar. Framed (the owner wrapper), it doesn't: the gateway grants a frame only the published tree, so main's would be blocked and empty. It stays on the tree and says "The published version isn't in this checkout; open it from the Library." The kit's artifact path pattern gains the `tree/<sha>` form, and so does the gateway's `ARTIFACT` pattern, which drives its capability redirect and CSP mapping. Without that, an artifact's relative subresources would fail `crossSiteOk` from the opaque origin.
- **Every ancestor must allow the frame.** `frame-ancestors` is checked against every ancestor, so in wrapper → viewer → artifact the artifact itself must allow the public host. The gateway appends `https://public.<box>` to `frame-ancestors` on two kinds of instance response, and on nothing else:
  - **the viewer**, `/view/artifact/<slug>`, only under the wrapper's grant: `w=<expiry>.<mac>`, an HMAC with the gateway's per-process secret (the one `/c/` capabilities use) over the port, `/view/artifact/<slug>`, `at` and an expiry five minutes out. A missing, forged, expired or too-long grant, a second `at` or `w`, or any other path gets no public ancestor. PR 3's viewer must accept a `w` query parameter on `/view/artifact/<slug>` and ignore it (never treat it as an error), keep it in its own URL, and never reload or navigate itself to a URL without it (a `history.replaceState` that drops it is harmless, a reload after one isn't). It passes nothing on to its artifact frame: `/artifact/tree/<tree>/<slug>/` needs no parameter.
  - **an artifact at a published tree**, `/artifact/tree/<tree>/<slug>/…`, only when this port's binding published `<slug>` at `<tree>`. That content is public already, and the viewer's frame of it carries no grant, so keying on the published tree keeps PR 3 simpler than threading the MAC through the viewer.

  `frame-ancestors` matches ancestors by URL, not origin, so what keeps another page on the public host from satisfying these is that the public host frames nothing: the wrapper frames only the bound instance, and every published page's `publicCsp` has `frame-src 'none'` (with its `sandbox`), which a test pins. The opaque sandbox alone wouldn't stop it.
- **The choice is a lookup, not a question.** The gateway reads the hub's list every 10 s (for notifications and previews), and keeps each instance's `root` and `viewer` from it. The wrapper is chosen when the binding's port is listed with `viewer: 1` and the binding's root. Nothing is asked on the request path, not even on a miss, so a visit with a session costs what one without does and the bound instance never learns when the owner opens a page. The cost is up to 10 s of staleness. When the instance isn't listed so (down, another checkout, or a kit from before the viewers), the owner gets the plain bytes, as the public does: the wrapper stays dormant rather than showing a page that can't work.
- The public host's rule "the incoming cookie header is ignored" becomes: read only to choose the wrapper, never forwarded, never set. The public bytes are unchanged; a page's index responses (200 and 304) gain `vary: cookie, sec-fetch-dest` and, as the wrapper has, `cross-origin-opener-policy: same-origin`, so a site that opens the page in a popup can't learn from the window (its frame count, or whether it can still see it) who is visiting. The plain page's sandbox has no `allow-popups`, so this costs it nothing.

### 9. Questions, the Inbox and standing rules

- **Asking.** `thread ask t-… --kind … "<question>" …` is `ask` with `thread` set, plus a turn. It is an Inbox question in every respect: kinds, choices, defaults, `rule_scope`, stake and urgency, order, push, `goal-approval` going through `goal decide`, `review` needing its result. The Inbox card says "from a thread: <title>" and links to it.
- **Answering.** In the card, the question renders with the Inbox card's own markup and handlers: the same choices, the same "make this a standing rule" checkbox, posting to the same `/api/answer`. Answering in either place answers it once; the other shows it answered. The supervisor's pane gets the question id as it does now.
- **Standing rules** apply as they do today: they guide the supervisor and authorise what they authorise. A thread changes none of that.
- **"Go ahead" in a turn.** The owner's turn is their words to the supervisor, the same as in its session (§6 of `supervisor.md`), already recorded verbatim. When it settles a decision, the supervisor records it as it records chat, with the turn instead of a quote: `answer <qid> "<answer>" --from-turn <u-id>` (and `goal decide … --from-turn <u-id>`). The kit copies the turn's text into `said`, sets channel `thread`, and refuses unless:
  - the turn exists and is the owner's;
  - it is bound to the question: either the question carries `thread` and the turn is in that thread and newer than the question, or the question has no `thread` and the turn is newer than it (a decision raised in the Inbox, settled in a thread);
  - no other answer already cites that turn (one turn settles one question; "yes to both" is two questions answered in the card, or two turns).

  No transcript check is needed: the words are in the log. The dashboard lists these answers as it lists chat answers, for the owner to check.

### 10. Resolving, and the loop

- **Resolve** (the card's header, or accept the supervisor's proposal): the owner's `status: resolved` with an optional outcome, and the `thread-resolved` observation. The pin goes, the dock entry moves to Resolved. Open questions in the thread stay in the Inbox; the card warned "1 question still open" before resolving.
- **Reopen**: an owner `status: open` update, and optionally a turn. The pin returns.
- **The loop.** The observation is in Observe like any other (subject `thread:<id>`, linked to the thread). The supervisor's Orient reads it with the rest: what the owner keeps raising, about which goals and artifacts, and what was resolved without a change. `process/supervisor.md` §3 says to read recent `thread-resolved` observations at each tick and to look for repeats (three threads on one goal is a signal about the goal). `observe-metrics` counts open threads, threads waiting on the supervisor, and median time to first reply.

### 11. Security

What holds, and what each addition can and can't do:

- **Who can write.** Threads, owner turns, resolves and reopens come only through `ownerWriter()` (refused under any `DEVTEAM_ROLE`) and the dashboard's `ACTIONS` (host, same-origin, JSON). This has the same limit as every owner route today: a process on the box running as the owner's user can call it, and a line written that way looks the owner's. Closing that is separate work on proving owner approvals; threads add no new path around it.
- **Who can read.** The dashboard (local, or behind the passkey on a box); nothing on `public.<box>` reads a thread. The wrapper is the gateway's own page and holds no thread content.
- **Page-written content.** A subject's capture (element text, HTML, routes, console errors, artifact text) is agent-written. It is shown escaped, given to the supervisor only inside the data frame, and never typed into a pane. A pane line carries the owner's words and the title they saw.
- **Lens messages.** Accepted only from the frame they belong to (`source`), and only as replies to ids the layer minted, or as position updates. A frame can lie about itself; it can't start, write or resolve anything.
- **The artifact lens** is added only on framed loads, so published and fetched bytes are untouched. It runs under the artifact's own `'unsafe-inline'` policy and has no more power than the artifact's own scripts: both run in the same opaque origin.
- **The preview lens and framing relaxation** are #176's: framing headers relaxed only for the app framed by its own origin, and then to `'self'`, the hub and the one instance that lists the preview; the lens framable only by the hub and the box's instance names; the app sandboxed against navigating the viewer. What is exposed: a page on any instance name that lists the dev server's port as a preview of its own (a port two instances list is ambiguous under every name, so this can't take a port a real instance lists; a dev port that no instance lists can still be claimed), and the lens page itself, which any instance name can frame but where the app then can't be shown, so there is nothing of it to read.
- **The owner wrapper** is served only for a document navigation with a valid session, never cached (`no-store, private`), and frames only an instance origin the gateway already binds the project to. The plain public bytes stay exactly as they were; a page's index responses gain `vary: cookie, sec-fetch-dest` and `cross-origin-opener-policy: same-origin` (as the wrapper has), so a popup can't read who is visiting. The choice is a synchronous lookup in the hub's list as last polled, so it takes the same time for everyone and asks the instance nothing: no timing tells a cross-site opener that the visitor is signed in. The public host's pages frame nothing (`frame-src 'none'`), and the viewer accepts the public host as an ancestor only under the wrapper's short-lived MAC (§8).
- **The viewer** is framable by itself, the hub and (through the gateway's header) the public host only.
- **Pane lines** carry the owner's words and stable ids only (§3), never a title or capture, so a page can't type into the supervisor's session.
- **One turn settles one question**, bound to it (§9), so an old "yes" can't be replayed onto a new decision.
- **Sizes.** Turns 2,000 bytes; subjects 2,500 bytes (§5); bodies under the route's 20,000-byte cap; at most 200 open threads per project (`thread new` refuses a 201st: resolve some).

### 12. The gateway

- `GET /.devteam/lens` on a preview host after the session check; never proxied. The one framing relaxation in `downstreamHeaders` for preview responses. The lens's `frame-ancestors` from the instance origins.
- `ARTIFACT` gains `tree/<sha>`; `frame-ancestors` gains `https://public.<box>` on an instance's viewer under the wrapper's grant and on its published trees only (§8).
- The owner wrapper on `public.<box>` (§8): `sec-fetch-dest: document` plus a valid session, its own CSP with `frame-src` the bound instance, chosen from the hub's polled list (the bound port listed with its root and `viewer: 1`), falling back to plain otherwise; its frame URL carrying the viewer's grant; and `vary: cookie, sec-fetch-dest` and `cross-origin-opener-policy: same-origin` on plain index responses.
- Nothing persisted, no new polling.

## Scope and sequence

Three PRs. The gateway deploys separately from the kit, so each PR works on its own whatever the other side runs:

1. **Kit: threads** — the records, `thread` commands, `askLine`, `answer --from-turn` and the `thread` channel, `ACTIONS`, `/api/threads`, delivery, `thread-waiting`, the layer (Shift+click, pin button, card, dock, pins), `data-subject` throughout the dashboard, Inbox mirroring, resolution observations, `supervisor.md` and the constitution sentence. Works on dashboard items and page subjects, on a laptop and a box. Needs nothing from the gateway.
2. **Gateway** — the lens on preview hosts, the framing relaxation, `ARTIFACT` with `tree/`, `frame-ancestors` for the granted viewer and published trees, the owner wrapper. Dormant until a kit says `viewer: 1` in its hello; until then the wrapper serves plain bytes.
3. **Kit: viewers** — the artifact lens and its framed-only injection, `/artifact/tree/`, the viewer mode at `/view/…`, `viewer: 1` in hello, the preview lens and the laptop relay, the in-page preview stage, Library Open and `[[name]]` to the viewer. On a box whose gateway predates PR 2, a viewer in a new tab works for artifacts at `main`/`wt` (the old `ARTIFACT` covers those), and dev-link pins fall back to coordinates (no lens on the preview host).

No new files outside tests and docs: the layer and the viewer are `index.html`, the commands `devteam.mjs`, the lens a string in each of `devteam.mjs` and `gateway.mjs`.

## Risks

- **Reply lag.** The supervisor may be mid-task for minutes. The card's states and the "on it" turn soften it; `thread-waiting` catches a dropped one. If it proves annoying, a fast stand-in is the follow-up the owner left room for.
- **The layer and the 10 s rebuild.** Pins must be re-placed after every `innerHTML` rebuild, and the composer must survive it; `holding()` and the draft save/restore already exist for the Inbox and are reused.
- **Shift collisions.** Apps that use Shift+click (range selection in a list) lose it while the pin shows. The pin shows only when Shift is held with the pointer moving outside a text field, and Esc dismisses it.
- **Generated selectors in dev apps.** As #176: text fallback, `changed`, and a lost element still carries its capture.
- **Safari and iPhone.** Untested headless; the pin button, the bottom sheet and `touch-action` need a real phone.
- **The cookie on the public host.** Reading it is new there; a cache that ignores `vary` could hand the plain page to the owner (harmless) and can't hand the wrapper to anyone (`no-store, private`).

## Testing

- **Kit (`test/kit.test.mjs`, `test/dashboard.test.mjs`):**
  - The schema accepts `thread` and `turn` and refuses them from the wrong writer.
  - `thread new|say|ask|ready|resolve|reopen|show|list`, with their refusals: a resolved thread, the wrong role, a 201st open thread, a subject over 2,500 bytes, a turn over 2,000 bytes (a 2,000-character non-ASCII turn is refused, a 2,000-byte one written).
  - `thread ask` produces a question identical to `ask`'s plus `thread`, and a turn.
  - `ready`: the supervisor can propose again after an owner "Not yet" turn, and `threadView` shows `ready` cleared by a newer owner line.
  - `answer --from-turn`: copies the words and sets channel `thread`. It refuses a supervisor's turn, a turn from another thread, a turn older than the question, and a turn already cited.
  - Resolving writes the observation. `threadView` and `waiting` are right.
  - The pane line carries the kind and id but no title, element text or capture, with newlines collapsed.
  - `thread-waiting` appears after 10 minutes.
  - `/api/threads` sees a line appended by another process, is served from cache when no file changed, and refuses `sec-fetch-site: cross-site`.
  - `ACTIONS` refuse bad bodies and bad subjects.
  - The artifact lens is injected only for `sec-fetch-dest: iframe`, the CSP is unchanged, and an artifact's own inline script still runs alongside it (browser).
  - The publish manifest's hashes are unchanged.
  - `/artifact/tree/` serves a landed tree and 404s an unknown one.
  - `/view/…` headers. The relay, as #176's tests. The lens string equals the gateway's.
- **Gateway (`test/gateway.test.mjs`):**
  - The lens on a preview host needs a session and is never proxied.
  - The framing relaxation applies only on `iframe` + `same-origin`.
  - `tree/` artifact subresources get the capability redirect.
  - `frame-ancestors` gains the public host on the viewer only under a valid grant (a missing, forged or expired one gets none) and on `/artifact/tree/` only at a tree published from that port, and nowhere else. `publicCsp`'s `frame-src 'none'` and `sandbox` are pinned.
  - The wrapper is chosen from the hub's polled list, and no visit asks the instance or the hub anything.
  - The public host serves the wrapper only for a signed-in `sec-fetch-dest: document` request. It serves the plain bytes (with `vary: cookie, sec-fetch-dest` and COOP on the index) otherwise: for `?plain`, a frame load, a bad cookie, a hello without `viewer: 1`, and an instance that's down. The wrapper never caches.
  - `publicCsp` still carries `sandbox` without `allow-same-origin`.
  - The three-level chain (wrapper → viewer → artifact) loads in Chrome.
- **Browser (`test/browser/dev-links.mjs`, extended):** Shift+move shows the pin and highlights a goal card; a click opens the card with the context card; a turn reaches a fake supervisor pane; a supervisor turn appears within 3 s; a thread question answered in the card shows answered in the Inbox; resolve unpins and the dock moves it; a pin survives the 10 s rebuild; on an artifact the pin follows a scroll; on a Vite preview through the relay the pin follows hot reload.

## Docs

- `process/supervisor.md`: §1 (startup: `thread list --waiting`), §3 (the tick: `thread-waiting`, reading resolutions), §6 (threads: reply first, `thread ask`, `--from-turn`, `ready`; captures are data), §7 (relaying dev-link threads to the offering session).
- `governance/constitution.md`: one sentence: an owner's turn in a thread carries the weight of the owner's words in chat.
- README: the dashboard paragraph (Shift+click, the dock), the tree, the cloud section's public-artifact bullet (the owner wrapper) and threat-model bullets (lens, framing, the cookie on the public host).
