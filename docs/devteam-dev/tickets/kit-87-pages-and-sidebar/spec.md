# kit-87: each nav item is its own page; the grouped side nav; the settings area and the Settings page

Ticket `kit-87-pages-and-sidebar` (kind `build`, size M, risk normal), feature `dashboard-cleanup`, design `project/designs/a-cleaner-more-consistent-dashboard.md` (home; sections `dashboard-shell@1`, Nav, pages and settings, Maximum parallel workers, Threads, The measure test), mock `project/artifacts/dashboard-cleanup/` (home, at main `3cb8d6b` for Settings). Serves DCL-S2 and DCL-S9. Consumes `docs/devteam/dashboard/shell.md@1` (`kit-83`, merged). Depends on `kit-83` (merged), `kit-85` (`POST /api/owner-setting`, with `value: null` meaning No limit, and `asked_settings` in `/api/data`), `kit-86` (the kit's default for the worker limits: none) and `kit-214` (steady Chrome tests); `kit-85` depends on `kit-84`, which serves `settings_all`. This spec and the plan are written ahead; the build starts only once all four have merged and the supervisor records approve-plan (ruling `m-20261115-194958983-supervisor`). The plan is re-read against main when the build starts.

## Why

Today the dashboard is one long scroll: the nav is eleven flat `#id` anchors into one `<main>`, the fleet-wide controls sit in an Overview strip, and the kit's settings can't be seen from the dashboard at all. The owner asked (thread `t-20261114-200804130-owner`, the mock's rulings, and thread `t-20261115-194652602-owner`) for one page per nav item with Back walking them, a nav grouped into Project and Autonomy, the fleet controls in a settings area at the bottom of the sidebar, and a Settings page that shows every kit setting and lets the owner set the worker limits. This ticket is the first to adopt the shell: it builds the frame (sidebar, page bar, pages, router) every later page ticket ports its page into, and it must lose nothing today's page has.

## How it works today (kit main `de07a84`)

- `index.html` (6,455 lines). `<div class="app">` (a grid: 232px sidebar, then the rest) holds `<aside class="side">` (brand, `<nav class="nav">` of eleven `<a href="#id">` with counts `n-goals`, `n-questions`, `n-progress`, `n-active`, `n-library`, `n-knowledge`, `n-trust`, `n-retros`, `n-findings`, `n-sensors`; a `.foot` with `#when`, `#saving`, `#logline`, `#err`) and `<main>` (`max-width: 1120px`, padded) with every section in one scroll: `overview` (`#fleet-strip`, `#down-banner`, `#stats`), `goals`, `inbox`, `progress`, `board`, `library`, `loop` (Observe/Orient/Decide/Act tabs in `#loop-tabs`, the tab remembered in `localStorage` `devteam.tab`), `trust` (h2 "Trust Ladder"), `retros`, `health`, `monitoring` (h2 "Sensors", holding a `<div id="sensors">`), and the hidden `review-view`. Banners (`#banner`, `#updated`, `#held`, `#stale`, `#loading`) sit at the top of `<main>`. Below 900px the sidebar becomes a horizontal row above the page and its `.foot` hides.
- `route()` (~4294) reads today's link heads (`preview/`, `artifact/`, `review/`, `review-preview`, `ticket/`, `q/`, `goal/`, `planner/`, `talk/`, `file?`, and the `PEEKS` kinds). A plain section head (`#inbox`) only scrolls. `closeDrawer()` (~3080) strips a peek's hash with `replaceState(null, …)`; `pushState` is never used and no entry carries `history.state`. `openQuestion` (~3994) sends an open question to the Inbox with `location.hash = 'inbox'` and a deferred `scrollIntoView` of `#q-<id>`. `leaveReview` (~4334) goes back, or to `#inbox` on a cold load.
- The thread layer: `tlSection` finds a section by `main > section[id]` and records page subjects as `#<section>[/<tab>]` (`#loop/observe`, `#monitoring`); `tlHome` looks for an item in `main #<T_HOME section>`; `tlGoTo` scrolls to the item or section (switching the Loop tab with `showTab`); `tlClose` replaces a `#talk/` hash with the subject's section by `replaceState(null, …)`.
- `fleetStrip()` (~2661) draws the Overview strip: the fleet's state (running, draining/drained, parking/parked, partly held) and `fleet.reason`, Drain all, Park all (a 6-second confirm), Resume, Check (`loadFleet(true)`: `/api/fleet?fetch=1`, "fetch from origin and check again"), ready or not, the parity hash and the blockers list. `loadFleet()` asks `/api/fleet` while the fleet is held (every 2 minutes, or 10 once ready). A global click handler (~6046) acts on any `[data-fleet]` and posts `press('fleet', { op })`. `hub-overview.test.mjs` waits on `typeof loadFleet === 'function'`.
- The shell (`kit-83`): the `devteam-layout` CSS block (scoped to `:where(.shell)`, fenced by `.no-shell`, weightless) and the `devteam-shell-js` block, both unused; no element has class `shell`. The page's own rules for `.seg` (a label wrapper), `.card`, `.card-head` and `main` come after the block and win at equal weight. `SHELL_ROUTES` (the `shell-routes` block) holds the end-state table: pages `overview, goals, inbox, progress, board, library, trust, governance, sensors, retros, loop, settings`; redirects `monitoring → sensors`, `health → sensors?st=fleet`. `test/dashboard-shell.test.mjs` asserts that table and reads `route()`'s `startsWith('…')` and `PEEKS` text for the link kinds.
- `/api/data` has `caps.max_active_tickets`, `fleet` (`mode`, `op`, `reason`) and `kit`. Before this builds, `kit-84` adds `settings_all` (one entry per `SETTINGS_DEFAULTS` key: key, group, plain name, description, the value in force from main, the kit default, `owner_only`; secrets by name only) and `kit-85` adds `POST /api/owner-setting` (allowlist `max_active_tickets`, `max_active_per_component`, each an integer or null) and `asked_settings` (per key: the value in force, `shown` such as "No limit", and the label).
- `test/dashboard-measure.test.mjs` has an empty `PAGES` list and a smoke run. `test/lib/measure.mjs`'s `page-top` check takes `.page`'s first shown child, ignored or not.

## What changes

### 1. The frame (adopting the shell)

- `<body>` gets class `shell`. Every region this ticket doesn't port gets `no-shell`: each page's old `<section>`, the review view, the old drawer (`#drawer`) and `#scrim`, the artifact viewer (`#artifact-view`), and the thread layer (`#tl`). Each later ticket takes `no-shell` off what it ports (`shell.md` §1).
- **The structure:** `.app` (today's grid) holds `.side`, then `<div class="main">` holding `<header class="pagebar">` (`h1` the page's title, `.extra` empty for now, `.tt` the Inbox button pinned right) and `<main class="page">`, which holds today's banners and every section. Sections stay direct children of `<main>`, so `main > section[id]`, `main #<id>` and `document.querySelector('main')` keep working.
- **The page's own rules narrowed** (`shell.md` §1 item 3): today's rules for names the block also styles are fenced to `.no-shell` regions, so the block styles the new frame and the old regions keep today's look: `main { … }` (its 1120px cap and padding become the block's `.page`), `.seg`, `.card`, `.card-head`, `.card.small .card-head`, and the sidebar's `.foot`. Inside `.no-shell` they read exactly as today.
- **The page bar** spans the window beside the sidebar, never capped by `--page-max`, `--bar-h` tall and sticky at the top; `.page` below it is at most `--page-max` with `--page-pad` at the sides.
- **Below 900px:** `.main` becomes `display: contents`, so the page bar, the sidebar row and the page are the grid's three rows, ordered page bar first (sticky at the top), then the horizontal, scrolling nav row (as today, sticky under `--bar-h`), then the page. So the Inbox button is at the window's top right at 390 wide as at 1440. The settings area folds into the nav row as a Settings link at its end.

### 2. The side nav, grouped

Two eyebrow groups (the mock's `.eyebrow`), each a `<nav class="nav">`:
- **Project:** Overview, Inbox, Goals, Progress, Board, Library. The Inbox item stays until `kit-100` moves the Inbox into the side panel.
- **Autonomy:** Trust (was Trust Ladder), Sensors, Health, Retros, Self Improvement (was Loop). Governance arrives and Health folds into Sensors with `kit-93`.

Each item keeps today's icon and count element (same ids, same counts, same hot state), links to its page head (`#overview`, `#inbox`, …, `#sensors`, `#health`, `#loop`), and carries `aria-current="page"` while its page shows. Pages register through the block's `registerPage({ id, title, group, icon, count, render })` in nav order (Settings in group `settings`), and the nav is drawn once from `shellPages()`, so the registry and the nav can't drift.

### 3. One page at a time

- Each page is today's section, shown alone. A section names its page with `data-page` (`#monitoring` is the `sensors` page; its inner `#sensors` div keeps its id), so no id a test reads changes.
- The page bar's title is the page's: Overview, Inbox, Goals, Progress, Board, Library, Trust, Sensors, Health, Retros, Self Improvement, Settings. Each old section's own `h2` stays (its links and badges are items today's page has) until its page ticket ports the page.
- Changing page scrolls to the top, unless the route scrolls to a target on the page (an open question's card, a thread's subject). Today's `scrollIntoView` of a section on a hash goes.
- The 10-second redraw is unchanged: every section is drawn every time, shown or not, so counts and the tab title stay right and nothing half-typed is lost.

### 4. The router

One `route()` reads every head through the block's `parseHead(hash, SHELL_ROUTES)` and stamps every entry with the block's `stampFor`. It keeps today's per-kind openers, and its text keeps naming each link kind (`startsWith('<kind>/')` and the `PEEKS` map), which `dashboard-shell.test.mjs` reads.
- **A page head** (`#<page>[?state]`) shows that page with its state keys. An unknown head (or the empty hash) shows Overview, its hash made canonical (`#overview`) by `replaceState`.
- **A link head** opens its peek (or the viewer, or a review) as today, over the page in its stamp: the page it was clicked on, or, on a cold load, its kind's home page from `SHELL_ROUTES.links` (a ticket over Board, a goal over Goals, …). A reload keeps `history.state`, so a peek opened over Progress reopens over Progress.
- **New entries are stamped at once:** an entry with no `history.state` (a hash assignment or an `<a href="#…">` click) gets `stampFor(entry, here, cold, SHELL_ROUTES)` by `replaceState`, `here` being what was on screen and `cold` true only on the visit's first route. Anything else that changes the hash (`tlClose`, a redirect, canonicalising) does so through the router with a stamp, never with `replaceState(null, …)`.
- **Closing a peek** (×, Escape, the scrim) follows `closeTarget(history.state)`: `history.go(-depth)` when the visit pushed the entries below it, else `replaceState` to the page under it, then routes. It never falls back to Overview unless that is the page.
- **An open question's link** (`#q/<id>` for an open question): its entry is replaced by `#inbox` (`replaceState`, stamped as a page head), then the Inbox shows and its card scrolls into view. So Back from the Inbox returns to the page the link was clicked on, never to the `q/` entry. Any other question opens its read-only peek over the page (cold: Overview), as today. From `kit-100` it opens the panel's Inbox tab instead.
- **The viewer and reviews** (`artifact/`, `preview/`, `review/`, `review-preview`) keep today's open and close code: the viewer closes by Back when opened in the visit, else to `#library`; a review closes by Back, else to `#inbox` (today's; a review is an Inbox question's page). The page under either is the stamp's.
- **`talk/<id>`** opens its thread's card over its subject's page (below, §5). Its entry is the `talk/` entry itself: the router changes that entry's recorded page to the subject's page head in place (`replaceState` with the block's `withPage`), and shows that page, adding no entry. So Back from the card returns to the page the link was clicked on, and a reload reopens the card over the subject's page.
- **The interim table.** `SHELL_ROUTES` is edited in place to the table this ticket's pages need, each interim entry marked by a comment naming the ticket that ends it (ruling `m-20261115-200347518-supervisor`):
  - `pages`: `health` added (`kit-93` folds it into Sensors); `governance` removed (`kit-93` adds the page). A governance file's cold-load home, `governance`, is then an unknown head and opens over Overview until `kit-93`.
  - `redirects`: `monitoring → sensors` stays; `health → sensors?st=fleet` removed (`kit-93` restores it); one entry per page, `<page>?th=inbox → inbox` (`kit-100` removes them, so `th=inbox` opens the panel); and today's page-subject views `loop/observe`, `loop/orient`, `loop/decide`, `loop/act` → `loop`, `loop?lt=orient`, `loop?lt=decide`, `loop?lt=act` (permanent: old threads keep these views).
  - For a page head carrying other keys as well as `th=inbox`, the router looks up the same `<page>?th=inbox` entry by the parsed page when `state.th === 'inbox'`, so the table stays the one place the rule lives.
  - Every redirect is followed by `replaceState`.
  - `test/dashboard-shell.test.mjs` (in touches by ruling `m-20261115-200347518-supervisor`) changes with it: its page list (`health` in, `governance` out), the `#health` case (now a page), the `#governance` and `#overview?th=inbox` round trips (now redirect or unknown), each assertion naming the interim and the ticket that ends it. `shell.md` stays as it is: it describes the end state and says `kit-93` and `kit-100` edit the table.
- **Self Improvement's tabs are history entries.** The Observe, Orient, Decide and Act tabs read and write the `lt` state key (`observe` is no key): a tab click assigns `#loop?lt=…`, and every other tab change (the thread layer's) goes through the same hash, so Back restores the earlier tab. `showTab` only draws the tab the route gives; `devteam.tab` is no longer read or written, so a fresh `#loop` opens on Observe (the contract: a missing key is the default; tabs are not remembered). The tabs keep today's look (`kit-96` rebuilds the page).
- Threads state (`th` other than `inbox`, `t`), the remembered filters and the other pages' filter keys are not wired here: their tickets (`kit-89`, `kit-90`, `kit-91`, `kit-92`, `kit-96`) build them on the same router.

### 5. The thread layer on separate pages

The thread layer stays `no-shell` and keeps its look; what changes is where it finds and shows its subjects:
- `tlSection` keeps finding a section by `main > section[id]` (the sections are still `<main>`'s children) and keeps recording page subjects as today (`#loop/<tab>`, `#monitoring`), so subjects already in the log keep their shape.
- **Going to a subject from a route** (a `talk/` link, cold or clicked): as in §4, the `talk/` entry's page becomes the subject's page in place, and no entry is added. The subject's page: for an item, the page its home element is on (the section holding `tlHome(s)`'s element, mapped by `data-page`; its Loop tab as `lt` when the item sits on another tab; the kind's `T_HOME` page when it isn't drawn; Overview with no subject); for a page subject, its view through the router's redirects (`#loop/orient` → `#loop?lt=orient`, `#monitoring` → `#sensors`). Once the page shows, the item scrolls into view and the card opens beside it.
- **Going to a subject from outside a route** (`tlGoTo` from the dock's list or a pin): it assigns the subject's page head (one new entry), then scrolls and opens the card as above.
- **Closing a thread card** opened by a `talk/` link follows `closeTarget(history.state)` as a peek does: Back when the visit pushed the `talk/` entry (to the page the link was clicked on), else `replaceState` to the subject's page head, then routes. A card opened from outside a route closes in place, as today.
- **Pins** are drawn only for subjects on the page shown (an element on a hidden page has no box, so `tlTargetRect` already gives none), and redraw on every page change.

### 6. The page bar's Inbox button

`.tt` reads Inbox with the red count of open questions (the nav's Inbox count). With the panels closed it sits at the window's top right on every page; pressing it opens the Inbox page (`#inbox`) until `kit-89` gives it the side panel and its thread counts.

### 7. The settings area (bottom of the sidebar)

Pinned to the sidebar's bottom (the mock's `.settings`): the block's `fleetSwitch({ scope: 'project', … })`, a line of the page's own under it, a Settings link (`#settings`), and the updated time with today's `#saving`, `#logline` and `#err`.
- **The switch's mode** is the fleet's: `run` when `fleet.mode` is unset, else `drain` or `park`.
- **The state line** (the page's own markup, outside the builder): today's words, "running", "draining…"/"drained", "parking…"/"parked" (settled once `fleet status` says the move is ready), or "partly held (a goal was set apart after the fleet op)", followed by `fleet.reason` when there is one.
- **Presses** go through `bindFleetSwitch` only; the old global `[data-fleet]` click branch (and its `check` case) goes, so each press posts once. Drain posts `{ op: 'drain' }`. Run posts `{ op: 'resume' }` when the fleet is held (mode set, or partly held) and does nothing when it is already running. Park asks once in place ("Confirm park"; Escape or another press cancels), and the confirm posts `{ op: 'park' }`. Each goes through `press('fleet', …)` with today's overlay, `apply`, `onOk` (`loadFleet()`) and `errId`.
- **State across redraws:** the page keeps the switch's `confirming`, `busy` and `error` and passes them back on every redraw, so the 10-second redraw never drops a pending confirm, a busy line or an error.

### 8. The Settings page (`#settings`)

Built on the shell (no `no-shell`), in the mock's sectioned style (mock at main `3cb8d6b`, Settings):
- **Ready to move?** (fleet status), shown by itself whenever the fleet is parked or drained: a card with the ready or not-ready state, each blocker from `/api/fleet` as a row, and the parity hash, with no button. Arriving on Settings calls `loadFleet(true)` (`/api/fleet?fetch=1`, "fetch from origin and check again", as Check did); `loadFleet()` still refreshes it every 2 or 10 minutes while the fleet is held.
- **Fleet** (the mock's section, in its order): the whole fleet (above 900px the row says "Run · Drain · Park from the sidebar" as the mock does; below 900px, where the sidebar's settings area is folded away, the row holds the fleet switch itself and its state line, the same state as the sidebar's); the two worker-limit controls (below); Memory ceiling (`machine_memory_ceiling`'s value from `settings_all`); and Kit (the kit release, `d.kit`).
- **The two worker limits**, Maximum parallel workers (`max_active_tickets`) and its per-component twin (`max_active_per_component`), the keys `kit-85` allowlists (ruling `m-20261115-195755200-supervisor`, info `m-20261115-200302629-supervisor`): each a − and + stepper (1 to `kit-85`'s maximum) with a No limit choice beside the number, then Save, shown only while the value differs from the one asked for. Save posts `{ key, value }` (an integer, or `null` for No limit) to `POST /api/owner-setting` through `press()`. Under each, the value in force and `kit-85`'s label from `asked_settings` (its `shown` "No limit"; "set by you", "set by the supervisor (you asked for N)", "saved; applies once the supervisor lands it", "the kit's default", "set by the supervisor"). A refusal shows its reason by the control and nothing else changes. The page keeps each stepper's pending value, busy state and error across the 10-second redraw.
- **Every setting** (done-when 6): every entry of `settings_all`, under its group heading, in `settings_all`'s order, as the mock at main draws it: the plain name, the key in mono, the value in force, a "yours to change" badge on `owner_only` keys, and the description under it. Every entry is listed, the two worker limits included, as read-only rows like the rest (as the mock at main lists them in Fleet and capacity); their controls are the Fleet section's. Nothing else on the page is editable. Below 700px a row's value wraps under its name.
- **The kit release** shows in the Fleet section's Kit row, in its group's row (`upstream_base`, as `settings_all` gives it), and in the brand as today.

### 9. What goes, and where it went

The Overview fleet strip (`#fleet-strip`, `fleetStrip()`) and its Check button, and the global `[data-fleet]` click branch. Every item the strip held moves: the state and reason (the state line, §7), Drain all, Park all and Resume (the switch), ready or not, the blockers and the parity (Ready to move?, §8), Check (arriving on Settings fetches and checks, §8). `loadFleet()` stays by name (`hub-overview.test.mjs` waits on it). `localStorage` `devteam.tab` goes (§4).

## Acceptance checks (the done-whens)

1. `test/dashboard-pages.test.mjs` (new, headless Chrome) passes in CI:
   a. at 1440×900 and 390×844, on every page with the panels closed, `.pagebar` spans the window beside the sidebar (wider than `--page-max` at 1440, so not capped by it), and `.pagebar .tt` ends `--header-pad` from the window's right edge with its top inside the page bar, which starts at the window's top; clicking it opens `#inbox`;
   b. the nav reads, in order, Project (Overview, Inbox, Goals, Progress, Board, Library), then Autonomy (Trust, Sensors, Health, Retros, Self Improvement);
   c. each nav link shows only its page (exactly one shown `[data-page]`, the right one), sets the page bar's title and marks itself `aria-current`; Back returns to the previous page;
   d. `#monitoring` opens `#sensors` by `replaceState`: clicked from Overview, `history.length` grows by exactly one, and Back lands on Overview; `#overview?th=inbox`, and `#board?goal=g&th=inbox`, open `#inbox` the same way, from `SHELL_ROUTES.redirects` outside the shared block (the test reads the entries in the table);
2. the same test, the router's history:
   a. a ticket link clicked on Progress opens its peek over Progress, and closing it returns to Progress;
   b. a cold load of `#ticket/<id>` opens over Board, and closing lands on `#board`;
   c. reloading a peek opened over Progress reopens it over Progress;
   d. Back after a tab change on Self Improvement (Observe, then Orient) restores Observe;
   e. an open question's `#q/<id>` link clicked on Goals shows the Inbox with its card in view, and Back returns to Goals;
   f. a `talk/<id>` link to a thread on a ticket (an item on Board), clicked on Goals, opens over Board with its card beside the ticket, adding one entry; Back returns to Goals; reloading the card's entry reopens it over Board; closing the card returns to Goals; a cold load of the `talk/` link opens over Board and closing it leaves `#board`;
3. the same test, the settings area and Settings: the settings area has the fleet switch, a Settings link and the updated time; Drain posts one `fleet` request with `op: 'drain'`; Run on a held fleet posts one with `op: 'resume'`, and on a running fleet posts none; Park asks once in place, Escape cancels it, and the confirm posts one with `op: 'park'` (each checked by the requests the page sends and the fleet's mode after); a pending confirm survives a redraw; the Settings page has Maximum parallel workers (− + Save posting `owner-setting` with the value, and No limit posting `null`; the label reads "saved; applies once the supervisor lands it" until the value is in force; a pressed + survives a redraw before Save) and, with the fleet parked or drained, Ready to move? (fleet status) with no button, after a `fetch=1` request; the Overview fleet strip and Check are gone;
4. `test/dashboard-measure.test.mjs` passes in CI with the sidebar, the page bar and the Settings page in its list, at 1440×900, 720×800 and 390×844, on every check (`prose`, `overflow`, `uneven`, `head-end`, `page-top`, `head-h`, `header-pad`, `tab-motion`): `#settings` whole; every other page with the default `view` replaced by a selector no element has, so its old `.no-shell` section (ignored by the other checks) isn't taken for the page's first content, whose `page-top` its own page ticket checks;
5. every item today's page has stays, checked one by one in the final review against the mock's inventory: the fleet strip's state, reason, Drain all, Park all, Resume and Check (now the switch, its state line and Ready to move?), the nav counts and their hot state, the updated time with `#saving`, `#logline` and `#err`, the banners, the Loop tabs, the thread layer's pins, cards and links, and every section's own content;
6. the same test as 1: the Settings page lists every entry of `settings_all` under its group headings as the mock at main shows (plain name, the key in mono, value, a "yours to change" badge on `owner_only` keys, the description under it); below 700px the value wraps under the name; nothing is editable except the two worker limits (`kit-85`'s allowlist).

Every test file that string-matches what moves is updated in this ticket (the design's Risks), `test/dashboard-shell.test.mjs` included (§4). Run locally one file at a time at `--test-concurrency=2`; CI is the gate.

## Contracts

Consumes `dashboard-shell@1` as written: the layout block's frame (`.main`, `.pagebar`, `.page`), sectioned status (`.sec`, `.rows`, `.rowline`, `.dot`, `.pill`), `.seg`, `.fleet-switch`, `.card`, `.card-head`; the JS block's `registerPage`, `shellPages`, `parseHead`, `headFor`, `stampFor`, `closeTarget`, `fleetSwitch`, `bindFleetSwitch`, `escHtml`. Neither block changes. `SHELL_ROUTES` (the page's own table, `shell.md` §6) changes to the interim table (§4). Provides nothing new. Uses `kit-84`'s `settings_all`, and `kit-85`'s `POST /api/owner-setting` and `asked_settings`, by the names their PRs land (agreed with them before the build if they differ from the above).

## Edge cases

- A link inside a peek opens a second peek at depth 2; closing it returns to the first; closing that returns to the page.
- A peek opened inside a cold-loaded peek closes in place (`closeTarget` replaces), never through history that isn't the visit's.
- Back into a peek entry reopens the peek over its recorded page; Forward likewise.
- A cold load of an unknown head (`#governance`, `#nonsense`) shows Overview with `#overview` in the address bar.
- A thread whose subject's element isn't drawn (a record no longer listed) opens its card over its kind's home page, as today it opened without scrolling.
- The fleet switch while a press is in flight: `busy` disables it; a refusal shows in its `.err`, and the mode returns to the data's.
- A Save refused by `kit-85`'s server (range, key, role, origin, no owner signature on a box): the reason by the control; the value in force unchanged.
- `settings_all` missing (an older server, or a read that failed): the Settings page shows the worker limits and Ready to move?, and says the settings list can't be read; nothing else breaks.
- `localStorage` unavailable: nothing here depends on it.
- Reduced motion: nothing here animates beyond what the block already stops.

## Out of scope

- The Threads side panel, its tabs and the button's thread counts (`kit-89`); the Inbox in the panel and the end of the `th=inbox` and `inbox` page entries (`kit-100`).
- The peek's motion and shape (`kit-88`); every page's own port, copy removal and grid (`kit-90` onward); filters and remembered filters (`kit-90`, `kit-91`, `kit-92`, `kit-96`); Governance, and Health into Sensors (`kit-93`).
- Changing either shared block (frozen until `kit-95`) or `shell.md`.
- The owner setting's server side (`kit-85`), `settings_all` (`kit-84`) and the kit's default (`kit-86`).

## Calls made here (the worker's)

- The page bar is the first row below 900px, so its Inbox button is at the window's top right at 390, as the done-when says; the mock put the nav row first.
- On a phone the settings area folds into a Settings link at the end of the nav row, and the Settings page's Fleet row holds the switch itself there, so no fleet control is lost below 900px (today's strip was reachable on a phone; the mock hid the settings area).
- Each old section keeps its `h2` until its page ticket, though the page bar now carries the title: the `h2`s hold links and badges that must stay.
- Run on a partly held fleet resumes at once, as today's Resume did; the mock's "Run every goal?" confirm is on the hub's project rows (`kit-94`), and the frozen switch has no Run confirm.
- A review cold-loaded closes to `#inbox`, as today (a review is an Inbox question's page), though the table's home for a review is Library.
- The Loop tab is no longer remembered across visits (`devteam.tab`): the contract puts tabs in the URL and remembers only filters.

## Rulings

- `m-20261115-194958983-supervisor`: plan ahead; write and review spec and plan now (the mock at main is the reference); build nothing until the dependencies merge and approve-plan is recorded. Subagent briefs carry lessons `k-20261115-182656232`, `k-20261115-080753394`, `k-20261115-164245020` and the scripts-in-files rule; run only touched files at `--test-concurrency=2`.
- `m-20261115-195734279-supervisor`: scope added from the owner (thread `t-20261115-194652602-owner`): every kit setting on the Settings page; done-when 6; the mock at main `3cb8d6b`, Settings.
- `m-20261115-195755200-supervisor` (on my `m-20261115-195631409`): a control for each key `kit-85` allowlists (`max_active_tickets`, `max_active_per_component`, each with No limit) and read-only rows for every other setting, from `kit-84`'s `settings_all`; no separate ticket; agree the shape with `kit-84` if needed.
- `m-20261115-200302629-supervisor` (info): the Settings controls with No limit are this ticket's; `kit-85` gives `POST /api/owner-setting` with `value: null` and `asked_settings.shown` "No limit" in `/api/data`; `kit-86` fixes the old `/cap` line. Draw the controls to the mock at main.
- `m-20261115-200347518-supervisor` (on my `m-20261115-200338269`): `test/dashboard-shell.test.mjs` is in touches; edit `SHELL_ROUTES` itself to the interim table, not an overlay, marking each interim entry with a comment naming the ticket that ends it (`kit-93`, `kit-100`).
