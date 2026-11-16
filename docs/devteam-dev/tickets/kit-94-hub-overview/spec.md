# kit-94-hub-overview: spec

The machine hub's Overview rebuilt on the dashboard shell: a header line with the summary and the machine fleet switch, then one card per project, two per row, each with the standard card head; a coloured dot and the Inbox counts on each project's tab; and the hub's own Settings view, opened from a link by the machine switch. Feature `dashboard-cleanup`, story DCL-S8. Design: `project/designs/a-cleaner-more-consistent-dashboard.md` (The pieces › The hub's Overview, The machine switch; the shell's two blocks). Mock: `project/artifacts/dashboard-cleanup/` at home's `origin/main` (`drawHub`, `hubSettings`, `HUB_SETTINGS`). Contract consumed: `docs/devteam/dashboard/shell.md@1` (both blocks unchanged; this ticket only calls them).

Owner threads folded in: `t-20261115-204437479-owner` (no Operator button or sidebar; the operator is talked to in the Terminal tab, raw tmux as today), `t-20261115-233337524-owner` (no Settings tab; the link by the machine switch is the only way in), `t-20261115-204523188-owner` (the box line and the header's box links and notifications move to the hub's Settings, in the project settings' format), `t-20261115-194652602-owner` (the gap audit's hub rows that stay: top goal with +N more and its merged bar, kit behind in amber, Not answering, "Update its kit to see what it is doing").

## Files

Only `docs/devteam/dashboard/hub.html`, `test/hub-overview.test.mjs`, `test/hub-measure.test.mjs` (the ticket's touches), and this folder.

## What changes in hub.html

### Adopting the shell

- `<body class="shell">`. The thread layer (`#tl`) and the dashboard and terminal frames get `no-shell` (the dock is unchanged, done-when 4). The header, the Overview (`#overview`) and the new Settings view are on the shell.
- The hub's own rules for names the layout block also styles go, so one rule styles each thing: `.ov-head` (and its `h1`, `.sum`, `.acts`, `.acts button`), `.pill` (all tones), `.seg` (all), `.ov-ctl`, `.ov-card.bad/.warn`, `.ov-box`, `.ov-ok`, `.ov-grid`. What the hub keeps for itself (`.tab`, `.ov-stats`, `.ov-att`, `.ov-mosaic`, the goal line, the card's own tuning) stays as page CSS after the block.
- `#ov-body` becomes the page (`class="page"`: at most `--page-max`, `--page-pad` sides, first content at `--page-top` below the header). The header is the hub's bar for the measure (`bar: 'header'`); it has no title or Inbox button, so `header-pad` has nothing to check.
- The header holds only the tab strip: `#notify` and `#box-links` leave it (they move to Settings, below). The tab strip, the Terminal tab, the drop hint and the frames behave as today.

### The project tabs

Each project's tab: a `.dot` in its state's tone (`PULSE_STATES[state].tone`: green building; blue moving or running; amber waiting; red blocked, stalled or gone, with `.pulse`, which the block's reduced-motion rule stills; grey for idle, parked, starting), then the name, then the counts. `title` is the state word (`PULSE_STATES[state].label`, e.g. "Not answering"). The state is the card's (`stateOf`, so a just-parked project's tab says Parked at once). The tab tooltip of path, port, kit, fleet and workers goes (gap audit: fine to drop).

The counts, from the project's hello (`inbox`: open questions; `threads: { you, waiting, ready }`, from kit-84), in a `.tab-counts` span:
- `.n.q` in red: the open questions, when more than 0;
- a `·` between when both show;
- `.n.th` thread count in the most pressing state's colour: `ok` (green) counting `ready + you` when `ready > 0`; else `you` (blue) counting `you` when `you > 0`; else `wait` (grey) counting `waiting` when `waiting > 0`; each with a title in words ("2 ready to accept, 1 your move", "1 your move", "all waiting on the supervisor");
- nothing when both are 0 (or the hello has no `threads`: an older kit shows the questions only).

The Overview tab's text stays exactly "Overview"; the Terminal tab is unchanged.

### The Overview

`paintOverview()` keeps its name and redraws `#ov-body` whole, as today (every card new; the pins find their parts again).

**The header** (`.ov-head`): `h2` "This machine" (pin `headline`), `.sum` the summary (pin `summary`): `N projects`, then each of these only when non-zero: `M moving` (building + moving + running), `W waiting on you`, `B blocked` (blocked + stalled + gone), `P parked`; then `.acts` with the machine fleet switch and the Settings link (`a.set[href="#settings"]`, "Settings"), the only way into Settings. No headline sentence, no box line, no Park all / Resume all, no Operator button. With no projects: the summary reads "No projects running" and there is no switch (the Settings link stays).

**The machine switch:** `fleetSwitch({ scope: 'machine', mode, counts, confirming, busy, error })` over the steerable projects (a dashboard answering, on a kit that sends a pulse, as today's `steerable`). Their modes are `modeOf(it)` (`run`, `drain`, `park`); `mode` is the one they share, or `mixed` (none pressed, "Mixed: n running, d draining, m parked") when they differ; `counts` are the three tallies. Hidden when no project is steerable.
- Run: `setFleet(roots, 'run')` for every steerable project not running (Run resumes all). Drain: every running one. Pressing the mode already shared does nothing.
- Park: the switch's Park becomes "Park N projects?" (the block's confirm; N = running + draining); a second press parks those; Escape or 5 s without the second press cancels.
- While it runs: `busy` "Parking N projects…" / "Draining…" / "Resuming…"; afterwards the first failure as `error` ("beta: its dashboard didn't answer…"), kept until the next press on that switch.

**A card per project**, in a `.g12` grid, each `article.c6.card.ov-card.click` (two per row at full width; the block folds `.c6` to one column below 560px), sorted as today (what needs the owner first, then by name). A card whose answer can't be read is a card of its own saying so, as today.

- **The head** (`.card-head`): the name (`button.ov-name.grow`, pin `name`, opens the project's dashboard), then "Partly blocked" (`pill amber`, when the pulse says `blocking: 'partial'` and the state isn't blocked; title "n of m open tickets wait on your answers"), then the partly-held pill (below), then the status pill (`statusPill(state)`, pin `state`), then ⋯ (`button.end.menu-btn`, last, at the head's right edge). The pills shrink before they push ⋯ out: each one's text truncates with an ellipsis when the head is too narrow.
- **The ⋯ menu:** a small popover (`.menu-pop`, fixed, closes on Escape, an outside click or a redraw) with the project's root and port, then "Open its dashboard" (selects its tab) and "Open in a new tab" (its URL, `noopener`).
- **Fully blocked** (state `blocked`), and any other red state (stalled, gone): the card has class `blocked`, a solid 1px red border with a faint red ring (the blocked ticket card's treatment); its head's divider stays `--line`.
- **The body:** the stats, two by two (Kit, Inbox, Working, Last moved), and the activity mosaic beside them (below them under 560px):
  - Kit: today's (`+local` shown as `+`); amber with the title "Behind the newest kit here (vX.Y.Z)" when older than the newest kit among the listed projects.
  - Inbox: the tab's counts (red questions, then the coloured thread count), or `0` when both are 0, as a button (pin `inbox`) that opens the project's dashboard at `#overview?th=inbox` (its frame's URL ends with that hash; an open frame is pointed there).
  - Working: the pulse's `working` (or the fleet's workers on a kit with no pulse); Last moved: `agoText(last_activity)`.
  - The mosaic: today's (`mosaic(days, commits)`, pin `activity`, with its label).
- **The top goal line** (pin `goal`): the pulse's goal title, "+N more" when `goals_open > 1`, then the merged bar (`.ov-bar`, pin `progress`, role progressbar): merged tickets in green and those waiting on the owner in amber, as shares of open + merged, with "d of t merged · h waiting on you" beside it ("No tickets planned yet" with none). No goal approved: "No goal approved yet", with the bar. A card with no pulse or a gone project has no goal line.
- **What needs the owner** (`.ov-att`, pin `attention`): the hello's `alert`, "Its dashboard stopped answering at <time>" for a gone project (red), then the pulse's attention lines (red for a stall or Fully blocked), at most five. No reassurance line when there is none ("Nothing needs you" and the like go; gap audit: fine to drop).
- **A project on an older kit** (a hello with an inbox but no pulse, still answering): in place of the stats and mosaic, "Update its kit to see what it is doing" (`p.hub-why`); no goal line, no switch.
- **The row switch** at the card's foot (`.foot`): `fleetSwitch({ scope: 'row', mode: modeOf(it), confirming, busy, error })` on steerable cards only. Park asks "Confirm park" (the block's), a second press parks; Escape or 5 s cancels; pressing the current mode does nothing except Run on a partly held fleet (below). While it runs, `busy` ("Parking…") disables the buttons; a failure shows in `.err` until the next press. Each button carries `data-k` (`<root>:<mode>`), so the focus survives the redraw between the two presses of Park (today's keyboard test).
- **Clicking a card** anywhere but a control (a button, a link, the switch, the menu) opens that project's dashboard, as its tab does. The thread layer's Shift+click and Pin still take their clicks first (the layer's capture listener, unchanged).

**The partly-held pill** (done-when 6), shown only when the hello carries `fleet.goals` (kit PR #275: `{ run, drain, park }` counts of holdable goals) and the goals are mixed (some, not all, held: `run < total` and not every goal in one mode):
- `a.pill.amber.held-pill`, text "Partly parked · R of T goals running" when any goal is parked, else "Partly draining · R of T goals running";
- its `title` lists each held goal and why when the hello names them (`fleet.goals.held = [{ title, mode, why }]`, ruling `m-20261116-022459643-supervisor`), else the counts ("9 parked, 0 draining");
- a click opens that project's dashboard at `#goals` (and doesn't also open the card);
- the switch stays. Its Run, which reads pressed while the fleet's mode is `run`, is live on a partly held fleet: the first press turns it into "Run every goal?" in place (class `confirm`, `data-confirm`; the block's binder hands the second press to `onConfirm('run')`), the second posts Run (`setFleet([root], 'run')`, which the dashboard posts as `fleet resume`, as today); Escape or 5 s cancels.

### The hub's Settings

A view of its own (`section#settings-view`, scrolling like `#overview`, its page `#hub-settings`), shown at `#settings` (the link sets the hash; `hashchange` and a cold load at `#settings` show it). No tab is selected while it shows; the Overview tab goes back. The thread layer is the Overview's, so it is hidden there, as on a project's tab.

Formatted as the mock's project settings: `.ov-head` with `h2` "Settings"; then a `.sec` per group, `.lbl` the group, `.rows` of `.rowline.set-row`: the name and its key (`code.set-key`), the value at the right with a `yours to change` badge where only the owner changes it, and under it `.set-desc`, what it does. Only what the hub has:

| Group | Rows (name · key · value) | Where |
|---|---|---|
| This machine | on a box, boxLine's parts: "Box release" · `DEVTEAM_KIT_RELEASE` · the image's release; "Hub" · `instances.json` · boxLine's hub part, amber when boxLine marks it; one row per tool, its name · `DEVTEAM_BOX_TOOLS` · its version. On a laptop: "Hub served by kit" · `instances.json` · the list's `kit` (or "a kit outside its project" when null) | always |
| Signing in | "Passkeys" · `passkeys` · a link "Manage" to box.json's passkeys URL; yours to change | box with `passkeys` only |
| Notifications | "New Inbox items" · `on this device` · today's control (Notify me… / Notifying you… / blocked / unavailable; push on a box, the browser's on a laptop); yours to change. "Test" · `on this device` · "Send a test" (box: `push/test` for this device's subscription; laptop: a local notification), shown only once notifications are on | always (the first row says why when the browser can't) |
| Serving | "Previews" · `previews` · a link "Previews" to box.json's previews URL | box with `previews` only |

The `boxLine` block stays as it is (marked, pure); Settings reads its parts. The strings the gateway test checks stay: `typeof b.previews === 'string' && secure(b.previews)`, `a.textContent = 'Previews'`, `if (box || !NOTIFY_OK`, the drop-hint and terminal-sandbox strings, `const urlOf = …`.

### What stays as it is

The thread layer (`#tl`, its dock, pins, cards, polls; `OP_PARTS` and the pin names `headline`, `summary`, `card`, `name`, `state`, `kit`, `inbox`, `working`, `moved`, `goal`, `progress`, `attention`, `activity`, `fleet`); `setFleet`, `fleetAsk` and the message rules (only the dashboard's own frame answers); `stateOf`, `modeOf`, `fleetSet`; the frames, the Terminal tab and the terminal frame; `draw()`'s list handling, gone detection and notifications; the address rules (`#overview`, `#terminal`, `#<project>`; `#settings` is new).

## Acceptance checks (the done-whens, restated)

1. **The Overview** (`test/hub-overview.test.mjs`, headless Chrome): the header line shows the summary and the machine switch in place of Park all / Resume all (no button reading either); its pressed segment is the shared mode, and with projects in different modes it reads Mixed with none pressed; its Park asks "Park N projects?" with N the count, and a second press parks them; Run resumes them all. Then one card per project, two per row at 1440px (each `.c6`, the two in a row at the same top); each card's head holds its name, its status pill (plus Partly blocked when the pulse says partial) and ⋯ last; the body shows Kit, Inbox, Working, Last moved, what needs the owner, the mosaic and the row switch (Park confirms; busy line while it runs; an error line when it fails). No goal list: one top goal line only. A click on a card opens that project's dashboard (its tab selected, its frame shown).
2. **The tabs** (same test): each project's tab has a dot of its state's tone (green, blue, amber, red with pulse, grey), checked for building, moving, waiting, blocked, gone and parked; the pulse animation is off under `prefers-reduced-motion: reduce`; the tab's `title` is the state word. After the name, the counts: red questions, then the thread count coloured and counted as above (ready, your move, waiting cases), nothing when both are 0.
3. **Blocked and Inbox** (same test): a fully blocked project's card has a solid red border, and its head's bottom border is `--line`'s colour; each card's Inbox stat shows the same counts as its tab, and clicking it opens that project's dashboard with its frame at `#overview?th=inbox`.
4. **Unchanged tests:** `test/gateway.test.mjs` and `test/operator-threads.hub.test.mjs` pass unchanged (CI); the dock is unchanged; there is no Operator button or operator sidebar on the hub, and the Terminal tab still frames the box's terminal.
5. **The measure** (`test/hub-measure.test.mjs`): the hub Overview (`/#overview`) and Settings (`/#settings`) are in `PAGES` and measure clean at 1440x900 and 390x844 with `test/lib/measure.mjs`, the view being each one's page, the bar the header, the thread layer and frames ignored.
6. **Partly held** (hub-overview test): a project whose hello carries `fleet.goals` mixed shows the amber pill in its head ("Partly parked · 2 of 11 goals running"); its title lists the held goals and why when `fleet.goals.held` is given, and the counts when it isn't (both tested); a click opens that project's dashboard at `#goals`; the switch stays; Run on it first reads "Run every goal?" and posts only on the second press. A hello without `fleet.goals` shows no pill.
7. **Settings** (hub-overview test): the Settings link by the machine switch opens `#settings`; there is no Settings tab in the header; the view has the groups, each row with its name, key, value, what it does, and "yours to change" on Passkeys and New Inbox items; on a laptop only This machine (the hub's kit) and Notifications; on a box also Signing in and Serving, This machine with boxLine's parts; the Overview shows no box line.
8. **The gap audit's rows** (hub-overview test): a card shows its top goal with "+N more" and its merged bar; a kit behind the newest is amber; a project that stopped answering shows Not answering on its card and its tab; a project on an older kit shows "Update its kit to see what it is doing".

## How it's tested

- **Pure parts in `vm`:** the counting and labelling rules sit in a marked pure block (`/* hub-overview start */ … end */`): the tab counts, the partly-held pill's words, the machine switch's mode and counts. The test runs them on fixtures, as the box-line test does.
- **The page with fixture hellos:** a small test server serves `hub.html` with an `instances.json` the test controls (and, for the box case, a `box.json` naming `*.localhost` URLs, which the page trusts on `http://hub.localhost`), and a stand-in dashboard on each instance's port that answers the hub's `hub-fleet` asks and records them. This covers every state, the counts, the partly-held pill and Settings without starting real fleets.
- **One run through real dashboards:** today's keyboard test, adjusted: Park by keyboard on alpha's card, the machine switch's Park ("Park 1 project?") and Run, a tab opening its dashboard; the part on who is not heard stays unchanged.
- The pulse and box-line tests at the top of the file stay; the box-line wiring test changes to Settings.
- On the box: only the touched test files, one at a time, at `--test-concurrency=2`; CI is the gate.

## Edge cases

- A hello with `threads: null` (an older kit): no thread count; questions only.
- A project with no pulse that is starting (`inbox` null): status Starting, grey dot, no stats beyond what it sends, no switch.
- Two projects of the same name: the tab key keeps today's `-<hex>` rule; the cards show the names.
- A press on a card's switch while a machine-wide op runs: the buttons are disabled (busy), as today.
- A redraw (every 10 s) during a confirm: the confirm, busy and error states are the page's (keyed per root and `machine`) and survive it; an open ⋯ menu closes.
- `fleet.goals` malformed (non-numbers, negatives, all zero): no pill.
- `fleet.goals.held` entries are text: titles and reasons go in as text (`title` attribute via the DOM), at most 20 listed.
- Settings on a box whose box.json omits passkeys or previews: that group is left out.
- 390px: the head's pills truncate instead of overflowing; the stats wrap; nothing scrolls sideways with the dock open (the operator-threads test's fit check).

## Contracts

Consumed: `dashboard-shell@1`: `PULSE_STATES`, `statusPill`, `fleetSwitch`, `bindFleetSwitch`, `escHtml`, and the layout block's `.page`, `.g12`/`.c6`, `.card`, `.card-head`, `.ov-head`, `.sec`, `.rows`, `.rowline`, `.dot`, `.pill`, `.seg`, `.fleet-switch`. Neither block changes. Read from each project's hello (via the hub's `instances.json`): `inbox`, `threads` (kit-84), `fleet.mode`, `fleet.workers`, `fleet.goals` (kit PR #275, optional), `pulse`, `alert`, `kit`. Provided: nothing new.

## Out of scope

The dashboard's own Overview and Settings (other tickets); the copy sweep (`kit-95`); `devteam.mjs` (the hello's fields); what `fleet resume` does with goals the owner held one by one; operator threads (unchanged).

## Open questions

None open.

## Rulings

- `m-20261116-022459643-supervisor` (on `m-20261116-022444736-kit-94-hub-overview`): draw the partly-held pill from `fleet.goals`' counts; its hover lists `fleet.goals.held = [{ title, mode, why }]` when the hello carries it, else the counts ("9 parked, 0 draining"). Test both. The supervisor asks for `held` in #275 or a follow-up.
