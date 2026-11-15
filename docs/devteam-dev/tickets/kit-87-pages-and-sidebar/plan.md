# kit-87 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- Seven tasks; product code only in `docs/devteam/dashboard/index.html`, one new test file (`test/dashboard-pages.test.mjs`), and updates to `test/dashboard-shell.test.mjs`, `test/dashboard-measure.test.mjs` and any touched test that string-matches what moves.
- T1 the interim `SHELL_ROUTES` (vm-tested); T2 the frame, grouped nav and one page at a time; T3 the router's history (peeks, `q/`, redirects, Loop tabs); T4 the thread layer on separate pages; T5 the settings area and fleet switch (the strip goes); T6 the Settings page (Ready to move?, every setting, the worker limits on their rows) and the measure list; T7 every Settings row a thread target (a page subject `#settings?key=<key>`, `m-20261115-202400898`).
- Neither shared block changes; the page's own `main`, `.seg`, `.card`, `.card-head`, `.side .foot` rules are fenced to `.no-shell`.
- The build starts only when `kit-84`, `kit-85`, `kit-86` and `kit-214` have merged and approve-plan is recorded; at that point re-read this plan against main (`settings_all`, `asked_settings`, `/api/owner-setting` names; `test/lib/chrome.mjs` after `kit-214`).
- Every Chrome test runs one file at a time at `--test-concurrency=2`; CI (test.yml, every job) is the gate.
- Risk: Chrome tests assume one scroll. T2 runs every Chrome file that loads the dashboard (found by grep, not a list) and fixes each break by navigating to the right page first, never by weakening an assertion; `#questions` (three files outside touches) is a legacy redirect to `#inbox`.

**Goal:** Turn the dashboard's one long scroll into one page per nav item with Back/Forward history, a grouped side nav, a settings area with the fleet switch, and a Settings page listing every kit setting with the two worker limits editable.

**Architecture:** `<body class="shell">`; `.app` holds `.side` (two eyebrow groups, the settings area at the bottom) and `.main` (`.pagebar` over `<main class="page">`). Today's sections stay `<main>`'s children, each `no-shell` and tagged `data-page`; one is shown at a time. One `route()` built on the frozen block's `parseHead`/`stampFor`/`closeTarget` decides the page and the peek. The Settings page is new markup on the shell.

**Tech Stack:** Inline HTML/CSS/JS in `index.html`; `node:test`; headless Chrome through `test/lib/chrome.mjs`; `test/lib/measure.mjs`.

**Spec:** `docs/devteam-dev/tickets/kit-87-pages-and-sidebar/spec.md` (and its Rulings). Contract: `docs/devteam/dashboard/shell.md@1`.

## Global Constraints

- Files: only the ticket's touches (`docs/devteam/dashboard/index.html`, `test/dashboard.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-shell.test.mjs`, `test/gateway.test.mjs`, `test/multirepo-views.test.mjs`, `test/ooda-learning.test.mjs`, `test/ooda-lineage.test.mjs`, `test/plain-questions.test.mjs`, `test/fleet-park.test.mjs`, `test/multirepo-landing.test.mjs`, `test/lib/kit.mjs`, `test/lib/chain.mjs`; `test/dashboard-answers.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/next-step.strategy.test.mjs` for navigation-only edits, only if the `questions` redirect isn't enough, every assertion unchanged (`m-20261115-201614084`)) and this ticket folder. `test/hub-overview.test.mjs` and `test/pane-question.answer.test.mjs` are run, never changed.
- Fences: the page's own rules are fenced with `:where(.no-shell) ` (no weight added), never a bare `.no-shell ` prefix.
- Chrome tests wait on conditions (`until(() => p.ev(…))` from `test/lib/kit.mjs`), never fixed sleeps.
- `devteam-layout` and `devteam-shell-js` stay byte-identical to `hub.html` (`dashboard-shell.test.mjs` checks); no new top-level name in the page may equal one of the block's.
- Marker blocks keep their names (`review-bridge`, `peeks`, `learning`, `loop-place`, `preview-cards`, `public-states`, `threads-core`, `threads-layer`, `shell-routes`).
- Interim `SHELL_ROUTES` entries each carry a comment naming the ticket that ends them (`kit-93` or `kit-100`).
- `loadFleet` keeps its name (`hub-overview.test.mjs`).
- Copy fixed by the spec: nav labels Overview, Inbox, Goals, Progress, Board, Library / Trust, Sensors, Health, Retros, Self Improvement; eyebrows Project, Autonomy; switch confirm "Confirm park"; label phrases from `kit-85` verbatim; "yours to change"; the setting thread title "Setting · <plain name> (<key>)"; its dock words "Settings, <plain name>".
- Tests: run one touched file at a time, `timeout 900 node --test --test-concurrency=2 <file>`; never the full suite; never pipe a gate's output. Gates go through `devteam.mjs gate test -- <command>`.
- Probes outside tests: own `HOME` (`mktemp -d`), `DEVTEAM_HUB_PORT` away from 4320, every `DEVTEAM_*` unset; scripts in files; guarded `rm -rf`.

## Readings of the spec

- Closing a peek opened inside a peek follows the contract (`shell.md` §7, `closeTarget`): × goes to the page under both (`go(-depth)`); Back from the second peek returns to the first. The spec's Edge case "closing it returns to the first" is read as Back (plan-1 P3); the test pins both.

## Review Focus

1. A peek link clicked inside a peek: Back returns to the first peek, × lands on the page under both, never Overview, never out of the visit (T3 test 2g).
2. The 10-second redraw while the owner is mid-action (a Park confirm pending, a + pressed before Save, a refusal showing): nothing resets (T5, T6 tests).
3. A phone (390 wide): the fleet switch is reachable (at the end of the nav row) and the Inbox button is at the top right (T2 test 1a at 390, T5 test).
4. An old thread whose subject is a page view (`#loop/orient`, `#monitoring`) or an item on another page: opening it shows the right page and tab (T4 tests).
5. `settings_all` absent (an older server): Settings still shows the worker limits and Ready to move?, and says the list can't be read (T6 test).

---

### Task 1: The interim router table

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (the `shell-routes` block, ~1254-1270)
- Test: `test/dashboard-shell.test.mjs` (~380-415)

**Interfaces:**
- Produces: `SHELL_ROUTES.pages` = `['overview','goals','inbox','progress','board','library','trust','sensors','health','retros','loop','settings']`; `SHELL_ROUTES.redirects` = `{ monitoring: 'sensors', 'loop/observe': 'loop', 'loop/orient': 'loop?lt=orient', 'loop/decide': 'loop?lt=decide', 'loop/act': 'loop?lt=act', questions: 'inbox' (until kit-100), '<page>?th=inbox': 'inbox' for every page }`. `links` and `files` unchanged.

- [ ] **Step 1: Change the table test first.** In "the router's table" test: the sorted page list becomes the Produces list sorted; `#health` parses to `{ page: 'health', state: {} }` (comment: until kit-93); `#governance` parses to `{ page: 'overview', state: {} }` (until kit-93); for every page `p`, `parseHead('#'+p+'?th=inbox')` is `{ page: 'inbox', state: {}, redirected: true }` (until kit-100); `#loop/orient` → `{ page: 'loop', state: { lt: 'orient' }, redirected: true }`, and `#loop/observe` → `{ page: 'loop', state: {}, redirected: true }`; `#questions` → `{ page: 'inbox', state: {}, redirected: true }` (today's Inbox list anchor; until kit-100), replacing the case that read it as unknown. In the round-trip test, drop `#overview?th=inbox` and `#governance` from `heads` and skip `?th=inbox` for pages (comment why); everything else round-trips unchanged.
- [ ] **Step 2:** `timeout 600 node --test --test-concurrency=2 test/dashboard-shell.test.mjs` — expect the changed cases to FAIL.
- [ ] **Step 3:** Edit `SHELL_ROUTES` in place: the `th=inbox` entries built from `pages` (e.g. `...Object.fromEntries(PAGES.map((p) => [`${p}?th=inbox`, 'inbox']))` with `PAGES` declared inside the marker block), each interim group under a `// until kit-93: …` or `// until kit-100: …` comment; the `loop/<tab>` entries commented as permanent (old page subjects).
- [ ] **Step 4:** Re-run the file — PASS (including the block-identity and kind-reading tests).
- [ ] **Step 5:** Commit `kit-87: T1 interim router table`.

### Task 2: The frame, the grouped nav, one page at a time

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (body ~760-940; the page's CSS ~236-280, 460-475; `route()` ~4294 for page heads; `render()` for counts)
- Create: `test/dashboard-pages.test.mjs`
- Modify: `test/dashboard-shell.test.mjs` ("today's pages can't change … neither page has a .shell": index now has `<body class="shell">`; assert that, that every old section, `#review-view`, `#drawer`, `#scrim`, `#artifact-view` and `#tl` carry `no-shell`, and keep the no-`.shell` check for `hub.html` until kit-94)
- Modify as needed: `test/dashboard.test.mjs` (any Chrome step that reads or clicks an element on a page not shown: navigate to that page first)

**Interfaces:**
- Consumes: T1's `SHELL_ROUTES`; the block's `registerPage`, `shellPages`, `parseHead`, `headFor`.
- Produces: `showPage(id: string, opts?: { keepScroll?: boolean }): void` (shows the section whose `data-page` is `id`, hides the others, sets `#page-title`, sets `aria-current` on the nav, scrolls to top unless `keepScroll`); `PAGE_NOW` (the shown page id); `sectionPage(el: Element): string` (the `data-page` of the section holding `el`, else `'overview'`); markup ids `#page-title`, `#inbox-btn` (`.pagebar .tt`), `#inbox-btn-n` (its red count), `#side-fleet`, `#side-state`, `#settings` (the Settings section, filled by T6).

- [ ] **Step 1: Write the failing test** `test/dashboard-pages.test.mjs`, set up as `test/dashboard-measure.test.mjs` is (own `HOME`, ports from `PORTS`, `DEVTEAM_*` removed, `bareProject`, `dashboardOnFreePort`, `openChrome`; skip unless `canDrive`; `t.after` cleanups). Test "pages and nav": wait for `!document.querySelector('main.waiting')`; nav text by group equals `[['Project',['Overview','Inbox','Goals','Progress','Board','Library']],['Autonomy',['Trust','Sensors','Health','Retros','Self Improvement']]]`; for each nav link: click, then exactly one `main > section[data-page]` is shown and its `data-page` equals the link's page, `#page-title` text equals the label (Self Improvement for loop), the link has `aria-current="page"`; `history.back()` shows the previous page; after scrolling Board down, clicking Library shows it at `scrollY === 0`; `#inbox-btn-n` text equals `#n-questions` text; a cold load of `#nonsense` shows Overview with `location.hash === '#overview'`. At 1440×900 and 390×844, on every page: `.pagebar` width > `--page-max` px at 1440; `innerWidth - #inbox-btn.right` within 0.5 of `--header-pad`; `.pagebar` top is 0 and `#inbox-btn`'s top is inside it; clicking `#inbox-btn` lands on `#inbox`.
- [ ] **Step 2:** Run it — FAIL.
- [ ] **Step 3: Markup.** `<body class="shell">`; `.app` > `.side` (brand; `.eyebrow` Project + `<nav class="nav" data-group="project">`; `.eyebrow` Autonomy + `<nav … data-group="autonomy">`; `.settings` with `#side-fleet`, `#side-state`, the Settings link `<a class="set" href="#settings">`, and today's `.foot` content `#when`, `#saving`, `#logline`, `#err`) and `<div class="main">` > `<header class="pagebar">` (`<h1 id="page-title">`, `<span class="extra"></span>`, `<button class="ghost tt" id="inbox-btn">` Inbox + `<span class="n q" id="inbox-btn-n">`) + `<main class="page waiting">` (today's banners and sections). Each old section gets `class="no-shell"` and `data-page` (`monitoring` → `sensors`); `#review-view` gets `no-shell` but no `data-page` (it is the review overlay, shown by `main.reviewing` as today, never hidden by the page rule); `#drawer`, `#scrim`, `#artifact-view`, `#tl` get `no-shell`. New `<section id="settings" data-page="settings">` (empty here; T6 fills it). Nav links are drawn once at load from `shellPages()` after registering the eleven pages plus `settings` (group `settings`, not drawn in the nav) with today's icons and count ids (`count: () => null`; `render()` keeps filling the count elements as now).
- [ ] **Step 4: CSS** (page's own, after the block): fence today's `main {…}`, `.seg`, `.card`, `.card-head`, `.card.small .card-head`, `.side .foot` rules to `.no-shell` regions with a `:where(.no-shell) ` prefix (no weight added); the mock's `.eyebrow`, `.settings`, `.settings a.set`, `.nav a[aria-current="page"]`; `main.page > section[data-page]:not(.on) { display: none }`; the settings link in the nav row (`.nav-set`) hidden above 900px. Below 900px: `.app` one column, `.main { display: contents }`, `.pagebar { order: 0 }` sticky top 0, `.side { order: 1; position: sticky; top: var(--bar-h) }` as a scrolling row whose `.settings` sits inline at its end (the switch and the Settings link; the updated time and foot hidden), `main.page { order: 2 }`. Drop `.nav-set` (the settings area itself is in the row).
- [ ] **Step 5: JS.** `showPage` (Produces); `route()` for a page head calls `parseHead(location.hash, SHELL_ROUTES)` and `showPage(p.page)`, replacing an unknown or empty head with `#overview` by `replaceState`; remove the two `document.getElementById(raw)?.scrollIntoView()` lines; `#inbox-btn` click sets `location.hash = '#inbox'`; `render()` copies the `n-questions` count into `#inbox-btn-n`.
- [ ] **Step 6:** Run the new test — PASS. Then list the Chrome files that load the dashboard (`grep -l "dashboardOnFreePort\|startDashboard" test/*.test.mjs` intersected with `grep -l openChrome`) and run each (`timeout 900`, concurrency 2), `test/dashboard-shell.test.mjs` too; for each failure caused by a hidden page in a touched file, make the test navigate to that page (`location.hash = '#<page>'` and wait) before reading or clicking; re-run until PASS. In the three files ruled in by `m-20261115-201614084`, edits are navigation only and every assertion stays unchanged; a failure in any other file outside touches goes to the supervisor as `blocked` with the failing step. Run `test/plain-questions.test.mjs`, `test/multirepo-views.test.mjs`, `test/ooda-learning.test.mjs`, `test/ooda-lineage.test.mjs`, `test/gateway.test.mjs`, `test/fleet-park.test.mjs`, `test/multirepo-landing.test.mjs` and `test/kit.test.mjs`'s chain only if it reads `index.html` (`grep` first; `test/lib/chain.mjs` matches `<section id="library">`, which must still match — keep the id first in the tag or loosen that regex to `<section id="library"`).
- [ ] **Step 7:** Commit `kit-87: T2 frame, grouped nav, one page at a time`.

### Task 3: The router's history

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (`route()`, `closeDrawer()` ~3080, `hideDrawer`, `openQuestion` ~3994, the Escape/scrim handlers, the Loop tabs ~4336-4346)
- Test: `test/dashboard-pages.test.mjs`

**Interfaces:**
- Consumes: `showPage`, `PAGE_NOW` (T2); block `parseHead`, `headFor`, `stampFor`, `closeTarget`.
- Produces: `HERE` (the stamp on screen, `{ page, depth, openedHere }`); `goHead(head: string, { replace?: boolean })` (sets the hash by assignment, or by `replaceState` with a fresh stamp, then routes); `loopTab(tab: string)` (assigns `#loop` or `#loop?lt=<tab>`).

- [ ] **Step 1: Failing tests** (one Chrome test "history", using a fixture with one ticket made with the kit CLI as the supervisor would, one open question (`ask`) and one answered one): 1d `#monitoring` from Overview → `#sensors`, `history.length` +1, Back → Overview; `#overview?th=inbox` and `#board?goal=g&th=inbox` → `#inbox`; 2a ticket link clicked on Progress → peek open, `#page-title` Progress, × → `#progress`; 2b cold load `#ticket/<id>` (new tab) → Board under the peek, × → `#board`; 2c open over Progress, `Page.reload` → peek over Progress; 2d `#loop`, click Orient → hash `#loop?lt=orient`, Back → Observe selected and hash `#loop`; 2e on Goals click a `#q/<open id>` link → `#inbox` shown, `#q-<id>` in view, Back → `#goals`; 2g (Review Focus 1) on Progress open the ticket peek, then a peek link inside it: `history.state.depth === 2`; Back → the first peek (depth 1) over Progress; Forward → the second; × → `#progress` with no peek. More: Back into a peek entry from its page reopens it over that page, and Forward too; a cold load of `#ticket/<id>`, then a link inside that peek, then × → `#board` in place (`history.length` unchanged by the close); a review: with a review page question in the fixture (as `test/dashboard.test.mjs` makes one), its `#review/…` link clicked on Inbox shows the review over Inbox (`#review-view` visible, `main.reviewing`), × goes Back to `#inbox`, and a cold load of the same link closes to `#inbox`; the viewer: `#artifact/main/<no-such>` cold lands on `#library` (today's), and an artifact or preview link clicked on Overview and closed returns to Overview. 1d's redirect heads are read from `SHELL_ROUTES.redirects` in the page (the `monitoring` entry and the `overview?th=inbox` entry), not typed in the test.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** `route()`: compute `cold` (a module flag set after the first route); if `history.state` lacks `page`, `history.replaceState(stampFor({ hash: location.hash, state: history.state }, HERE, cold, SHELL_ROUTES), '')`; follow the `th=inbox` lookup for heads with other keys (`state.th === 'inbox'` and `SHELL_ROUTES.redirects[p.page + '?th=inbox']`) via `goHead(…, { replace: true })`; for any redirect (`p.redirected`) `replaceState` the canonical head; `showPage(parseHead(history.state.page).page)` for a link head, `showPage(p.page)` for a page head; keep every opener branch's `startsWith('<kind>/')` text and `PEEKS`. Set `HERE = history.state` right after stamping, before any branch returns (every peek branch returns early).
- [ ] **Step 4:** `closeDrawer()`: after hiding, `const c = closeTarget(history.state); c.go ? history.go(c.go) : goHead(c.replace, { replace: true })`; drop its `replaceState(null, …)`. Escape and the scrim call `closeDrawer` as now.
- [ ] **Step 5:** `openQuestion` for an open question: `hideDrawer()` (not `closeDrawer`, which now goes back in history), then `goHead('#inbox', { replace: true })`, then after `showPage` scroll `#q-<id>` into view (`keepScroll`). Loop tabs: the tab click calls `loopTab`; `showTab` only draws; `TAB` comes from the route's `lt` (`'observe'` when absent); delete the `devteam.tab` read and write.
- [ ] **Step 6:** Run the new test and `test/dashboard.test.mjs` — PASS.
- [ ] **Step 7:** Commit `kit-87: T3 router history`.

### Task 4: The thread layer on separate pages

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (`threads-layer` block: `tlGoTo` ~5160, `tlClose` ~5487, `tlOpen`; the page-change hook in `showPage`)
- Test: `test/dashboard-pages.test.mjs`

**Interfaces:**
- Consumes: `showPage`, `sectionPage`, `goHead`, `loopTab`; block `withPage`, `closeTarget`.
- Produces: `subjectHead(s): string`.

- [ ] **Step 1: Failing tests:** 2f with a thread on the fixture ticket (`thread new` with an item subject `ticket:<id>`, through the owner channel as `test/dashboard.test.mjs` starts threads): on Goals click a `#talk/<tid>` link → `history.length` +1, Board shown, `history.state.page` is `#board`, the card open beside the ticket card (its box within 400px of the ticket's); `Page.reload` → card again over Board; × → hash `#goals` (Back by `closeTarget`); Back from a fresh open also → `#goals`; a cold load of `#talk/<tid>` → Board, × → `#board`; a thread with page subject `{ kind: 'page', view: '#loop/orient' }` → `#loop?lt=orient` shown; one with view `#monitoring` → Sensors shown; after Back from a `talk/` card the card is closed (spec-3 F3-2); a thread whose subject isn't drawn (an item ref to a ticket id not in the data) opens over its kind's `T_HOME` page; opening a thread from the dock's list on Overview adds one entry and shows Board, and its × closes the card in place (no history move); clicking a pin keeps the page and opens the card (`tlOpen(id, false)`, spec-3 F3-1); pins: the ticket thread's pin is drawn on Board and not on Overview.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Add `subjectHead(s): string` (the subject's page head: an item's `sectionPage(tlHome(s))` with `lt` when on a hidden `.loop-panel`, else its `T_HOME` page, else `#overview`; a page subject's view through `parseHead`/`headFor`, so redirects map old views). `route()` on a `talk/` head: if the thread isn't loaded, show the stamp's page at once (the cold case: the kind's home from `SHELL_ROUTES.links`, Overview for `talk`), `await tlRefresh()`, and, if `location.hash` changed meanwhile, drop the result; then `history.replaceState(withPage(history.state, subjectHead(s)), '')`, `showPage` that page, `tlOpen(id, false)` and scroll the item into view. Leaving a `talk/` entry (any route to a head that isn't that `talk/` head) closes its card. `tlGoTo` from the dock's list only: `location.hash = subjectHead(s)` only when the page or Loop tab differs from what is shown, then scroll after the page shows; a pin keeps `tlOpen(id, false)` as today. `tlClose`'s `#talk/` branch → `closeTarget(history.state)` (`history.go` or `goHead(page, { replace: true })`). `showPage` calls `tlPins()` after switching.
- [ ] **Step 4:** Run the new test, `test/dashboard.test.mjs`, and `test/kit.test.mjs` only if it drives the dashboard's thread layer (check with `grep -n tlGoTo test/*.mjs test/lib/*.mjs`) — PASS.
- [ ] **Step 5:** Commit `kit-87: T4 thread layer on pages`.

### Task 5: The settings area and the fleet switch

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (`fleetStrip` ~2661 removed; `loadFleet` kept; `render()`'s fleet lines ~4712; the `[data-fleet]` click branch ~6046 removed; `#fleet-strip` markup removed)
- Test: `test/dashboard-pages.test.mjs`

**Interfaces:**
- Consumes: block `fleetSwitch`, `bindFleetSwitch`; `press`, `loadFleet`, `FLEET`.
- Produces: `FLEET_UI = { confirming: false, busy: null, error: null }`; `fleetMode(f): 'run'|'drain'|'park'`; `fleetStateLine(f, st): string` (HTML: the state words and `fleet.reason`); `drawFleet(): void` (draws `#side-fleet`, `#side-state`, and T6's Settings copies, from `DATA.fleet`, `FLEET.data` and `FLEET_UI`); `postFleet(op: 'drain'|'resume'|'park'): void`.

- [ ] **Step 1: Failing tests** ("settings area"): the test page wraps `window.fetch` to record `POST /api/fleet` bodies (`window.__posts`). In `.settings`: `.fleet-switch[data-scope="project"]`, `a[href="#settings"]`, `#when` text starts "updated". Drain → exactly one post `{ op: 'drain' }`, then the mode shows drain; Run (held) → one `{ op: 'resume' }`; Run (running) → no post; Park → button reads "Confirm park" and has focus; two redraws (`render(DATA)` in the page) keep it and its focus; Escape restores "Park" with no post; Park, confirm → one `{ op: 'park' }`. With `fetch` stubbed to hang, a press disables the switch's buttons and shows the busy line; stubbed to answer 500 with `{ error: 'nope' }`, the error shows in `.fleet-switch .err` and the mode returns to the data's. The state line reads each of today's words for a fixture fleet (running; draining…; parked once `fleet status` is ready) with `fleet.reason` after it. At 390×844 the switch is visible in the nav row. `#fleet-strip` and any `[data-fleet="check"]` are absent.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement the Produces: mode `run` unless `fleet.mode`; `fleetStateLine` words "running", "draining…"/"drained", "parking…"/"parked" (settled when `FLEET.data?.ready`), "partly held (a goal was set apart after the fleet op)", then ` · <reason>`; `bindFleetSwitch(document.querySelector('.app'), …)` once: `onPress('park')` sets `confirming`; `onPress(m)` otherwise clears it and posts (`run` → `resume` only when held, else nothing); `onConfirm` posts park; `onCancel` clears; `postFleet` uses today's `press('fleet', …)` overlay/apply/onOk with `busy` set while in flight and `error` from `onError`. `drawFleet` writes a container's HTML only when it changed, and after a write while `confirming` focuses the confirm button again (the binder's Escape needs focus inside the switch). `render()` calls `drawFleet()` and keeps today's `loadFleet()` cadence; `loadFleet` redraws via `drawFleet()` instead of the strip.
- [ ] **Step 4:** Run the new test, `test/dashboard.test.mjs`, `test/fleet-park.test.mjs`; also `test/hub-overview.test.mjs` (not in touches; must still pass unchanged) — PASS.
- [ ] **Step 5:** Commit `kit-87: T5 settings area and fleet switch`.

### Task 6: The Settings page and the measure list

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (`#settings` section; `drawSettings()`; CSS `.set-key`, `.set-desc`, `.set-row`, `.limit` from the mock at main `8e59d9f`)
- Modify: `test/dashboard-measure.test.mjs` (`PAGES`)
- Test: `test/dashboard-pages.test.mjs`

**Interfaces:**
- Consumes: `loadFleet`, `press`; `/api/data` `settings_all` (`[{ key, group, name, description, value, default, owner_only }]`, names as `kit-84` lands them) and `asked_settings` (`{ <key>: { value, shown, label } }`, as `kit-85` lands them); `POST /api/owner-setting { key, value: number|null }`.
- Produces: `LIMITS = ['max_active_tickets', 'max_active_per_component']`; `SET_UI = { <key>: { pending: number|null|undefined, busy, error } }`; `drawSettings(): void` (called from `render()` and on arriving at Settings).

- [ ] **Step 1: Failing tests** ("settings page"): `#settings` has no Fleet section (no `.sec` labelled Fleet, no `.fleet-switch` inside `#settings`); each `LIMITS` key's row, in its group, holds the control (a No limit button, − and + around the number) and Save hidden until changed; from No limit, + gives 1, and − at 1 stays 1; + then `render(DATA)` keeps the value and Save (Review Focus 2); Save posts `{ key: 'max_active_tickets', value: <n> }` to `/api/owner-setting`, and No limit then Save posts `value: null`; after the save the row's label text equals `asked_settings.max_active_tickets.label` from a fresh `/api/data` and reads "saved; applies once the supervisor lands it" (the value isn't on main in the fixture); a refused save (value 0 forced through the page's `press`) shows the server's reason. Every `settings_all` entry appears once as a row under its `group` heading in order, with the name, `code.set-key` key text, value (the control for the two limits), and "yours to change" exactly on `owner_only` entries, the description under it; no input or button in any row but the two limits'. At 690 wide a row's value box sits below its name box. Fleet parked (post park, wait): "Ready to move?" card shown with each `/api/fleet` blocker, no button inside it, and a request to `/api/fleet?fetch=1` was made on arriving at `#settings`; running: no card. The `fetch=1` request is made even when a `loadFleet()` was already in flight on arrival (`loadFleet` queues a fetch asked for while busy). With `settings_all` removed from the data (`DATA = { ...DATA, settings_all: undefined }; render(DATA)`): the limits and the card still draw, and a line says the settings can't be read (Review Focus 5).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Build `#settings` as the mock at main draws it (Ready to move? first when held, then `settingsAll()`'s groups, the limits' rows holding `limitControl`): use the block's `.sec`, `.rows`, `.rowline`, `.card`, `.card-head`, `.dot`, `.pill`, `.seg`; Save through `press('owner-setting:<key>', { build: () => ({ action: 'owner-setting', body: { key, value } }), … })` keeping `SET_UI` across redraws; arriving at `#settings` (in `showPage`) calls `loadFleet(true)` and `drawSettings()`; `loadFleet(fetchToo)` called while busy records `FLEET.wantFetch` and runs once more with `fetch=1` when the running call ends. Each row carries `data-setting="<key>"` (T7 uses it). Owner-only badge: `<span class="badge amber">yours to change</span>`.
- [ ] **Step 4:** `test/dashboard-measure.test.mjs`: `PAGES` gets `{ hash: '#settings', ready: "!document.querySelector('main.waiting')" }` and, for every other page id, `{ hash: '#<id>', ready: …, opts: { view: '#no-such-view' } }` (comment: the old section is `.no-shell`; its `page-top` is its page ticket's); the smoke branch stays for an empty list.
- [ ] **Step 5:** Run `test/dashboard-pages.test.mjs`, then `test/dashboard-measure.test.mjs` — PASS; fix layout (not the checks) for any failure.
- [ ] **Step 6:** Commit `kit-87: T6 Settings page and measure list`.

### Task 7: Every Settings row a thread target

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (`threads-core`: `tWhere`, `tSubjectAt`; `threads-layer`: `tlStart`, `tlTargetRect`, the pin place ~5634, `tlGoTo`, the dock's "not on the page now" note ~5323 and `gone` ~5667; `subjectHead` from T4)
- Test: `test/dashboard-pages.test.mjs`, `test/dashboard.test.mjs` (`tWhere` cases in vm, beside today's)

**Interfaces:**
- Consumes: T6's `[data-setting]` rows and `settings_all`; T4's `subjectHead`.
- Produces: `parseSettingView(view: string): string|null` (the key when `view` is `#settings?key=<key>` and the key matches `^[a-z][a-z0-9_]{0,63}$`, else null); `settingRow(key): Element|null` (`#settings [data-setting="<key>"]`).

- [ ] **Step 1: Failing tests.** vm (dashboard.test.mjs, threads-core loaded as today): `tWhere({ kind: 'page', view: '#settings?key=max_active_tickets' })` reads "Settings, " plus the name the page knows (or the key without data); `tKey` differs for two keys; `parseSettingView` rejects `#settings?key=Bad Key` and `#settings`. Chrome (dashboard-pages): on `#settings`, Shift+click the `max_active_tickets` row → a new-thread card titled `Setting · ${name} (max_active_tickets)` with `name` read from `settings_all`; send words → `/api/threads` has a thread with subject `{ kind: 'page', view: '#settings?key=max_active_tickets', quote: name }`; its pin's box overlaps the row's top right; a second Shift+click on the row opens that thread (no new card; the thread count unchanged); the dock's list row reads `Settings, ${name}`; a thread on `max_active_per_component` has its own pin; from Overview, opening the first thread's `#talk/<tid>` shows `#settings`, the row in view (its box inside the viewport) and carrying `.tl-marked`, which goes when the card closes.
- [ ] **Step 2:** Run both files — FAIL.
- [ ] **Step 3:** `tSubjectAt`: an element inside `[data-setting]` gives `{ kind: 'page', view: '#settings?key=<key>', quote: <name> }` and the title above (before the generic page-spot rule, which would record a point). `tlStart`: for a setting subject, if an open thread has the same `view`, `tlOpen` it instead of a draft. `tWhere`, `tlTargetRect`, the pin place, the "not on the page now" note and `gone`: a setting view uses `settingRow(key)` as an item uses `tlHome`. `tlGoTo`/`subjectHead`: `#settings`, then scroll the row into view and add `.tl-marked` while the card is open (CSS outline in `--blue`).
- [ ] **Step 4:** Run `test/dashboard.test.mjs` and `test/dashboard-pages.test.mjs` — PASS.
- [ ] **Step 5:** Commit `kit-87: T7 settings rows as thread targets`.

## After the tasks

- [ ] Merge `origin/main`; re-run `test/dashboard-pages.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard.test.mjs` one at a time through `devteam.mjs gate test -- …`.
- [ ] Push; CI on the PR (`gate ci -- gh run watch <run> --exit-status`, unpiped; confirm the conclusion with `gh run view`).
- [ ] `verification.md`: a row per done-when (1–8) with the command, result and commit; done-when 5 names the inventory walk for the final review.
- [ ] Final review from a fresh subagent that hasn't seen the build, walking the mock's inventory item by item; `check-ticket`; `merge-request`.
