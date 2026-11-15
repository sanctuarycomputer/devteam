# kit-87: each nav item is its own page; the grouped side nav; the settings area and the Settings page

Ticket `kit-87-pages-and-sidebar` (kind `build`, size M, risk normal), feature `dashboard-cleanup`, design `project/designs/a-cleaner-more-consistent-dashboard.md` (home; sections `dashboard-shell@1`, Nav, pages and settings, Maximum parallel workers, Threads, The measure test), mock `project/artifacts/dashboard-cleanup/` (home). Serves DCL-S2 and DCL-S9. Consumes `docs/devteam/dashboard/shell.md@1` (`kit-83`, merged). Depends on `kit-83` (merged), `kit-85` (the owner setting and its `/api/data` label) and `kit-214` (steady Chrome tests); this spec and the plan are written ahead, and the build starts only once both have merged and the supervisor records approve-plan (ruling `m-20261115-194958983-supervisor`).

## Why

Today the dashboard is one long scroll: the nav is eleven flat `#id` anchors into one `<main>`, the fleet-wide controls sit in an Overview strip, and how many workers run at once can't be seen or set from the dashboard. The owner asked (thread `t-20261114-200804130-owner` and the mock's rulings) for one page per nav item with Back walking them, a nav grouped into Project and Autonomy, the fleet controls in a settings area at the bottom of the sidebar, and Maximum parallel workers on a Settings page. This ticket is the first to adopt the shell: it builds the frame (sidebar, page bar, pages, router) every later page ticket ports its page into, and it must lose nothing today's page has.

## How it works today (kit main `de07a84`)

- `index.html` (6,455 lines). `<div class="app">` holds `<aside class="side">` (brand, `<nav class="nav">` of eleven `<a href="#id">` with counts `n-goals`, `n-questions`, `n-progress`, `n-active`, `n-library`, `n-knowledge`, `n-trust`, `n-retros`, `n-findings`, `n-sensors`; a `.foot` with `#when`, `#saving`, `#logline`, `#err`) and `<main>` with every section in one scroll: `overview` (`#fleet-strip`, `#down-banner`, `#stats`), `goals`, `inbox`, `progress`, `board`, `library`, `loop` (Observe/Orient/Decide/Act tabs, `.tabs`), `trust` (h2 "Trust Ladder"), `retros`, `health`, `monitoring` (h2 "Sensors", holding a `<div id="sensors">`), and the hidden `review-view`. Banners (`#banner`, `#updated`, `#held`, `#stale`, `#loading`) sit at the top of `<main>`. Below 900px the sidebar becomes a horizontal row and its `.foot` hides.
- `route()` (~4294) reads today's link heads (`preview/`, `artifact/`, `review/`, `review-preview`, `ticket/`, `q/`, `goal/`, `planner/`, `talk/`, `file?`, and the `PEEKS` kinds). A plain section head (`#inbox`) only scrolls. `closeDrawer()` (~3080) strips a peek's hash with `replaceState(null, …)`; `pushState` is never used and no entry carries `history.state`.
- `fleetStrip()` (~2661) draws the Overview strip: the fleet's state (running, draining/drained, parking/parked, partly held), Drain all, Park all (a 6-second confirm), Resume, Check (`/api/fleet?fetch=1`), "ready to move" or "not ready", the parity hash and the blockers list. `loadFleet()` asks `/api/fleet` while the fleet is held (every 2 minutes, or 10 once ready). The click handler (~6046) posts `press('fleet', { op })` with an overlay. `hub-overview.test.mjs` waits on `typeof loadFleet === 'function'` in each dashboard.
- The shell (`kit-83`): the `devteam-layout` CSS block (scoped to `:where(.shell)`, fenced by `.no-shell`) and the `devteam-shell-js` block (`tabBar`, `bindTabBar`, `fleetSwitch`, `bindFleetSwitch`, `registerPage`, `parseHead`, `headFor`, `stampFor`, `withPage`, `closeTarget`, …) are in the page, unused. `SHELL_ROUTES` (the `shell-routes` block) lists pages `overview, goals, inbox, progress, board, library, trust, governance, sensors, retros, loop, settings` and redirects `monitoring → sensors`, `health → sensors?st=fleet`. No element has class `shell`, so nothing on the page is styled by the block yet.
- `/api/data` has `caps.max_active_tickets` (the value in force), `fleet` (`mode`, `op`, `reason`) and `kit`. `kit-85` adds `POST /api/owner-setting` and the label of the value in force.
- `test/dashboard-measure.test.mjs` has an empty `PAGES` list and a smoke run.

## What changes

### 1. The frame (adopting the shell)

- `<body>` gets class `shell`. Every region this ticket doesn't port gets `no-shell`: each page's old `<section>`, the old drawer (`#drawer`) and `#scrim`, the artifact viewer (`#artifact-view`), the review view, and the thread layer (`#tl`). Each later ticket takes `no-shell` off the region it ports (`shell.md` §1).
- The layout: the sidebar on the left (232px, today's width and look), and `.main` holding the **page bar** (`.pagebar`: `h1` the page's title, `.extra` empty for now, `.tt` the Inbox button pinned right; the full window width beside the sidebar, never capped by `--page-max`; `--bar-h` tall, sticky at the top) over the **page** (`.page`: at most `--page-max`, `--page-pad` at the sides). Today's banners stay at the top of the page area, above every page, as now.
- **Below 900px** the sidebar becomes a horizontal, scrolling row as today, but under the page bar: the page bar is the window's first row, so its Inbox button is at the window's top right at 390 wide as at 1440 (the done-when; the mock put the nav row first, which this changes for that reason). The settings area folds into that row as a Settings link (icon and word) at its end, so the fleet switch stays reachable on a phone through the Settings page (below).

### 2. The side nav, grouped

Two eyebrow groups (the mock's `.eyebrow`), each a `<nav class="nav">`:
- **Project:** Overview, Inbox, Goals, Progress, Board, Library. The Inbox item stays until `kit-100` moves the Inbox into the side panel.
- **Autonomy:** Trust (was Trust Ladder), Sensors, Health, Retros, Self Improvement (was Loop). Governance arrives and Health folds into Sensors with `kit-93`.

Each item keeps today's icon and count element (same ids, same counts, same hot state), links to its page head (`#overview`, `#inbox`, …, `#sensors`, `#health`, `#loop`), and carries `aria-current="page"` while its page shows. Pages register through the block's `registerPage({ id, title, group, icon, count, render })` in nav order; the nav is drawn from `shellPages()`, so the registry and the nav can't drift.

### 3. One page at a time

- Each page is today's section, shown alone. A section maps to its page by a `data-page` attribute (`#monitoring` is the `sensors` page; its inner `#sensors` div keeps its id), so no test-matched id changes.
- The page bar's title is the page's title: Overview, Inbox, Goals, Progress, Board, Library, Trust, Sensors, Health, Retros, Self Improvement, Settings. Each section's own `h2` stays as it is (its links and badges are items today's page has) until its page ticket ports the page.
- Changing page scrolls to the top. Today's `scrollIntoView` of a section on a hash goes (a page is its own view now).
- The 10-second redraw is unchanged: every section is drawn every time, shown or not, so counts and the tab title stay right and nothing half-typed is lost.

### 4. The router

One `route()` reads every head through the block's `parseHead(hash, SHELL_ROUTES)` and stamps every entry with the block's `stampFor`:
- **A page head** (`#<page>[?state]`) shows that page with its state keys. An unknown head (or the empty hash) shows Overview, its hash made canonical by `replaceState`.
- **A link head** opens its peek (or the viewer, or a review) as today, over the page in its stamp: the page it was clicked on, or on a cold load its kind's home page from `SHELL_ROUTES.links` (a ticket over Board, a goal over Goals, …). A reload keeps `history.state`, so a peek opened over Progress reopens over Progress.
- **New entries are stamped at once.** An entry that arrives without `history.state` (a hash assignment or an `<a href="#…">` click) gets `stampFor(entry, here, cold, SHELL_ROUTES)` by `replaceState`, `here` being what was on screen and `cold` true only on the visit's first route.
- **Closing a peek** (×, Escape, the scrim) follows `closeTarget(history.state)`: `history.go(-depth)` when the visit pushed the entries below it, else `replaceState` to the page under it. It never falls back to Overview unless that is the page.
- **Redirects**, each by `replaceState`, from `SHELL_ROUTES.redirects`: `#monitoring` → `#sensors`; and a `th=inbox` head opens the Inbox page (`#inbox`) until `kit-100` (the hub's Inbox stat links `#overview?th=inbox`). The table gets one entry per page, `<page>?th=inbox` → `inbox`, which `parseHead` follows for the canonical head; for a head carrying other keys as well, the router looks up the same entry by the parsed page (`<page>?th=inbox`) when `state.th` is `inbox`. Both live in `SHELL_ROUTES`, outside the shared block, and `kit-100` swaps them.
- **The table changes** (outside the block): `pages` loses `governance` (no Governance page until `kit-93`) and gains `health` (a page until `kit-93`); `redirects` loses `health → sensors?st=fleet` (`kit-93` puts it back). `links` and `files` stay; a governance file's cold-load home, `governance`, is not a page yet, so it opens over Overview (the unknown-head rule) until `kit-93`.
- **Self Improvement's tabs are history entries.** Its Observe, Orient, Decide and Act tabs read and write the `lt` state key (`observe`, the default, is no key): a tab click assigns `#loop?lt=…`, so Back restores the earlier tab. The tabs keep today's look (`kit-96` rebuilds the page); only where the selection lives changes.
- Threads state (`th` other than `inbox`, `t`), the remembered filters and the other pages' filter keys are not wired here: their tickets (`kit-89`, `kit-91`, `kit-92`, `kit-90`, `kit-96`) build them on the same router.

### 5. The page bar's Inbox button

`.tt` in the page bar reads Inbox with the red count of open questions (the nav's Inbox count). With the panels closed it sits at the window's top right on every page; it opens the Inbox page (`#inbox`) until `kit-89` gives it the side panel. Its thread counts come with that panel (`kit-89`).

### 6. The settings area (bottom of the sidebar)

Pinned to the sidebar's bottom (the mock's `.settings`): the block's `fleetSwitch({ scope: 'project', … })`, a Settings link (`#settings`), and the updated time. Today's `#saving`, `#logline` and `#err` stay with the updated time.
- **The switch's mode** is the fleet's: `run` when `fleet.mode` is unset, else `drain` or `park`. A fleet that is partly held (`fleet.op` without `mode`) shows `run` with today's words "partly held" in the switch's line, and Run resumes it as Resume did.
- **Presses** go through `bindFleetSwitch`, posting exactly what the strip posted: Drain posts `{ op: 'drain' }`, Run posts `{ op: 'resume' }` when the fleet is held (and does nothing when it is already running), Park asks once in place ("Confirm park"; Escape cancels), and the confirm posts `{ op: 'park' }`, all through `press('fleet', …)` with today's overlay and `errId`. The page keeps the switch's `confirming`, `busy` and `error` and passes them back on every redraw, so the 10-second redraw never drops a pending confirm or an error.
- While held, today's transition words stay visible in the switch's line: "parking…"/"draining…" until `fleet status` says the move is ready, then "parked"/"drained".

### 7. The Settings page (`#settings`)

Built on the shell (no `no-shell`), in the mock's sectioned style:
- **Ready to move?** (fleet status), shown by itself whenever the fleet is parked or drained: a card with the ready or not-ready state, each blocker from `/api/fleet` as a row, and the parity hash, with no button (Check goes; `loadFleet()` still refreshes it while the fleet is held, and opening Settings asks once).
- **Fleet:** the whole fleet (the fleet switch itself, which on a phone is the only place it shows; above 900px the row says it is in the sidebar, as the mock does), **Maximum parallel workers** (− and +, from 1 to 20, then Save, which shows only when the value differs from the saved one), and the line under it from `kit-85`'s label: "set by you", "set by the supervisor (you asked for N)", "saved; applies once the supervisor lands it" (with the value in force) or "the kit's default"/"set by the supervisor". Save posts `{ key: 'max_active_tickets', value }` to `kit-85`'s `POST /api/owner-setting` through `press()`; a refusal shows its reason by the control and nothing changes.
- **Kit:** the kit release (`d.kit`).
- Exactly which further settings rows and controls the page carries (`max_active_per_component`, "No limit") waits on the supervisor's ruling (below).

### 8. What goes

The Overview fleet strip (`#fleet-strip`, `fleetStrip()`) and its Check button. Every item it held moves (§6, §7): the state and reason, Drain all, Park all and Resume (the switch), ready or not, the blockers and the parity (Ready to move?). `loadFleet()` stays, by name (`hub-overview.test.mjs` waits on it).

## Acceptance checks (the done-whens)

1. `test/dashboard-pages.test.mjs` (new, headless Chrome) passes in CI:
   a. at 1440×900 and 390×844, on every page with the panels closed, `.pagebar` spans the window beside the sidebar (wider than `--page-max` at 1440, not capped by it) and `.pagebar .tt` ends `--header-pad` from the window's right edge, its top within the page bar at the window's top; clicking it opens `#inbox`;
   b. the nav reads, in order, Project (Overview, Inbox, Goals, Progress, Board, Library) then Autonomy (Trust, Sensors, Health, Retros, Self Improvement);
   c. each nav link shows only its page (one shown `[data-page]`, the right one, and the page bar's title), and marks itself `aria-current`; Back returns to the previous page;
   d. `#monitoring` opens `#sensors` by `replaceState` (no new entry: `history.length` unchanged, Back leaves the visit's previous page); `#overview?th=inbox` (and a head with other keys and `th=inbox`) opens `#inbox`, from `SHELL_ROUTES.redirects`, outside the shared block;
2. the same test, the router's history:
   a. a ticket link clicked on Progress opens its peek over Progress, and closing it returns to Progress;
   b. a cold load of `#ticket/<id>` opens over Board, and closing lands on `#board`;
   c. reloading a peek opened over Progress reopens it over Progress;
   d. Back after a tab change on Self Improvement (Observe → Orient) restores Observe;
3. the same test: the settings area holds the fleet switch (Park asks once in place, then posts `fleet` with `op: 'park'` as the strip did; checked by the request the page sends and the fleet's mode after), a Settings link and the updated time; the Settings page has Maximum parallel workers (− + Save posting `owner-setting`; "saved; applies once the supervisor lands it" until the value is in force) and, with the fleet parked or drained, Ready to move? (fleet status) with no button; the Overview fleet strip and Check are gone;
4. `test/dashboard-measure.test.mjs` passes in CI with the sidebar, the page bar and the Settings page in its list, at 1440×900, 720×800 and 390×844, on every check (`prose`, `overflow`, `uneven`, `head-end`, `page-top`, `head-h`, `header-pad`, `tab-motion`): `#settings` whole, and every other page with its old section left out (it is `.no-shell`, and its `page-top` belongs to its page ticket);
5. every item today's page has stays, checked one by one in the final review against the mock's inventory: the fleet strip's Drain all, Park all and Check (now the switch and Ready to move?), the nav counts, the updated time (and with them `#saving`, `#logline`, `#err`, the banners and every section's own content).

Each test file that string-matches what moves is updated in this ticket (the design's Risks). Run locally one file at a time at `--test-concurrency=2`; CI is the gate.

## Contracts

Consumes `dashboard-shell@1` as written: the layout block's frame, page bar, `.page`, sectioned status, `.seg`, `.fleet-switch`, `.card`; the JS block's `registerPage`, `shellPages`, `parseHead`, `headFor`, `stampFor`, `closeTarget`, `fleetSwitch`, `bindFleetSwitch`. Neither block changes; `SHELL_ROUTES` (the page's own) does, as `shell.md` §6 allows. Provides nothing new. Uses `kit-85`'s `POST /api/owner-setting` and its `/api/data` label, by the names its PR lands.

## Edge cases

- A link inside a peek opens a second peek at depth 2; closing it returns to the first; closing that returns to the page.
- A peek opened inside a cold-loaded peek closes in place (`closeTarget` replaces), never through history that isn't the visit's.
- Back into a peek entry reopens the peek over its recorded page; Forward likewise.
- The viewer (`artifact/`, `preview/`) and reviews (`review/`, `review-preview`) keep today's open and close behaviour, over the page they were opened from (their home, Library, on a cold load).
- A `talk/<id>` link: its thread card opens over the page the router knows for its subject (as `T_HOME` places it today), else Overview.
- `localStorage` unavailable: nothing here depends on it.
- The fleet switch while a press is in flight: `busy` disables it; a refusal shows in its `.err` and the mode returns to the data's.
- A Save refused by `kit-85`'s server (range, key, role, origin, no owner signature on a box): the reason by the control; the value in force unchanged.
- A cold load of an unknown head (`#governance`, `#nonsense`) shows Overview with `#overview` in the bar.
- Reduced motion: nothing here animates beyond what the block already stops.

## Out of scope

- The Threads side panel, its tabs and the button's thread counts (`kit-89`); the Inbox in the panel and the `th=inbox` swap (`kit-100`).
- The peek's motion and shape (`kit-88`); every page's own port, copy removal and grid (`kit-90` onward); filters and remembered filters (`kit-90`, `kit-91`, `kit-92`, `kit-96`); Governance and Health into Sensors (`kit-93`).
- Changing either shared block (frozen until `kit-95`).
- The owner setting's server side (`kit-85`) and the kit's default (`kit-86`).

## Calls made here (the worker's)

- The page bar is the first row below 900px, so its Inbox button is at the window's top right at 390 as the done-when says; the mock put the nav row first.
- On a phone the settings area folds into a Settings link at the end of the nav row, and the Settings page shows the fleet switch itself there, so no fleet control is lost below 900px (today's strip was reachable on a phone; the mock hid the settings area).
- Each old section keeps its `h2` until its page ticket, though the page bar now carries the title: the `h2`s hold links and badges that must stay.
- The `th=inbox` rule is one redirect entry per page in `SHELL_ROUTES`, plus the router's lookup of the same entry for heads with other keys.
- Open questions go to the supervisor, not into code (below).

## Open questions (to the supervisor)

1. **The Settings page's rows.** `kit-85`'s done-whens (as amended for the owner's thread `t-20261115-194652602-owner`) allowlist `max_active_per_component` beside `max_active_tickets`, each also taking null (No limit), and say "the Settings control for each offers No limit beside a number". The owner's same thread asks that every setting the dashboard doesn't show be represented on the Settings page. My ticket's done-whens name only Maximum parallel workers. Recommendation: `kit-87` draws a control for each key `kit-85` allowlists (each with No limit) and read-only rows for the effective settings `/api/data` gives; the wider "every setting" audit lands in the ticket the supervisor files for that thread. See Rulings.
2. **`kit-85`'s `/api/data` field** for the value in force and its label: I'll use the names its PR lands; I ask `kit-85` for them when its spec is written.

## Rulings

- `m-20261115-194958983-supervisor`: plan ahead; write and review spec and plan now (the mock at main is the reference); build nothing until the dependencies merge and approve-plan is recorded. Subagent briefs carry lessons `k-20261115-182656232`, `k-20261115-080753394`, `k-20261115-164245020` and the scripts-in-files rule; run only touched files at `--test-concurrency=2`.
