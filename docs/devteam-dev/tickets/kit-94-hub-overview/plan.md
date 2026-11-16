# kit-94-hub-overview: plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (the worker builds task by task; a fresh subagent reviews each task into `reviews/task-<n>.md`). Steps use checkbox (`- [ ]`) syntax.

## TL;DR

- One file changes, `docs/devteam/dashboard/hub.html`, plus its two tests; the shell's blocks are called, never edited.
- T1: a pure, `vm`-tested block (`/* hub-overview start */`) holds the counting and labelling rules: tab counts, the partly-held pill, the machine switch's mode, reserved address keys.
- T2: the hub adopts the shell. It gets project tabs with a dot, a state title and counts, and the Overview's header and cards. These are tested in Chrome against a fixture hub server with stand-in dashboards.
- T3: the switches (machine and per card) on the shared builder, with a per-key state map, `data-k` focus, Escape, and the partly-held "Run every goal?" confirm.
- T4: the hub's Settings view at `#settings`, opened only from the link by the machine switch. The box line, notifications, Passkeys and Previews move there.
- T5: the measure lists the Overview and Settings at three sizes, and the real-dashboards keyboard test moves from Park all / Resume all to the machine switch.
- On the box, Chrome tests run with Node 24 (`~/.local/share/mise/installs/node/24.14.1/bin/node`), one file at a time, `--test-concurrency=2`; CI is the gate.

**Goal:** the spec at `docs/devteam-dev/tickets/kit-94-hub-overview/spec.md` (approved at 25d12f1, `approve-spec` m-20261116-023526852).

**Architecture:** `paintOverview()` keeps redrawing `#ov-body` whole from `items` every 10 s. Pure rules sit in a marked block for `vm`. DOM is built with the page's `el()` helper; the shared builders return HTML strings that go into small wrappers. Switch UI state lives in one map keyed by root or `machine`.

**Tech:** plain browser JS in one HTML file; `node:test`; headless Chrome via `test/lib/chrome.mjs`; `test/lib/measure.mjs`.

## Global constraints

- Touch only `docs/devteam/dashboard/hub.html`, `test/hub-overview.test.mjs`, `test/hub-measure.test.mjs`, `test/dashboard-shell.test.mjs` (its "no .shell yet" loop only; ruling m-20261116-024531651) and this ticket folder.
- `devteam-layout` and `devteam-shell-js` stay byte-identical to index.html's (`test/dashboard-shell.test.mjs` checks this; run it after each task that touches hub.html).
- Keep these strings or hooks: `.ov-card`; `[data-pin="name"]` in a card; `#ov-body [data-pin="headline"]`; `paintOverview`; `#overview` scroll box with `#tl-pins` in it; the Overview tab's text exactly `Overview`; a project tab's text starting with its name. Gateway strings: `const urlOf = …`, `if (box || !NOTIFY_OK`, `typeof b.previews === 'string' && secure(b.previews)`, `a.textContent = 'Previews'`, the drop guard with exactly two `e.preventDefault()` directly before `// The hub on a laptop has no box.json`, the terminal frame's sandbox line, `Drop onto the Terminal tab`.
- Text from a hello goes in as text (`textContent`, attributes through the DOM), or through `escHtml` in the shared builders.

## Review focus

1. **A redraw mid-interaction:** a confirm, busy line or error must survive the 10-second `draw()`, and focus must stay on the switch button (T3: tests press Park, force `paintOverview()`, then press again by keyboard).
2. **Escape on both confirms** (Park on the machine switch, "Run every goal?" on a card) cancels without posting (T3 test).
3. **A hello from an older or odd kit:** `threads: null`, no `pulse`, malformed `fleet.goals`. Each must cost nothing but its own part (T1 vm cases; T2 fixture card "old").
4. **390px with long names and three pills:** nothing sticks out of the head or scrolls sideways (T2 fixture name of 40 characters plus partly blocked and partly held; T5 measure).
5. **A project named `settings` / `overview` / `terminal`:** its address doesn't capture the view (T1 `hubKey` cases; T4 test opens `#settings` with a project named `settings` listed).

---

### Task 1: the pure rules

**Files:** Modify `docs/devteam/dashboard/hub.html` (a new marked block after `/* box-line end */`; `keyOf` uses `hubKey`). Test: `test/hub-overview.test.mjs` (new tests near the box-line tests; a loader like `boxLineFn` that slices `/* hub-overview start */`…`/* hub-overview end */` and runs it in `vm`).

**Produces (global functions):**
- `tabCounts(inbox, threads) -> { q: number, th: null | { n: number, tone: 'ok'|'you'|'wait', title: string } }`. `q` = inbox when it is an integer > 0, else 0. `th` follows the spec: `ready>0` gives `ok`, n = ready+you, title `"<ready> ready to accept"` plus `", <you> your move"` when you>0; else `you>0` gives `you`, n = you, title `"<you> your move"`; else `waiting>0` gives `wait`, n = waiting, title `"all waiting on the supervisor"`; else null. Non-object `threads` or non-integer/negative fields count as 0.
- `heldPill(fleet) -> null | { word: 'Partly parked'|'Partly draining', running, total, text, title }`. Needs `fleet.goals` with run, drain, park all integers ≥ 0, total > 0, and at least two of the three > 0. `text` is `"<word> · <run> of <total> goals running"`. `title`: when `goals.held` is an array, its first 20 entries with a string `title` give lines `"<title>: <why>"` (or `"<title>: <mode>"` without `why`), joined with `\n`, each through the page's `tLine(s, 200)`. Otherwise `"<park> parked, <drain> draining"`.
- `machineMode(modes) -> { mode: 'run'|'drain'|'park'|'mixed'|null, counts: { running, draining, parked } }`. `modes` is an array of 'run'|'drain'|'park'; empty gives mode null.
- `hubKey(name, twins, hex) -> string`. Returns `"<name>-<hex>"` when `twins` or name ∈ {overview, terminal, settings}, else name. `keyOf(it)` becomes `hubKey(it.x.name, twins, hex6.get(it.x.root))`.

- [ ] **Step 1: Write the failing tests** `'the Overview\'s rules: tab counts'`, `'… the partly-held pill'`, `'… the machine switch\'s mode'`, `'… addresses a view never loses'`. Cases include: `tabCounts(3, {you:1,waiting:1,ready:1})` → `{q:3, th:{n:2, tone:'ok', title:'1 ready to accept, 1 your move'}}`; `tabCounts(0,{you:2,waiting:0,ready:0}).th` → `{n:2,tone:'you',title:'2 your move'}`; `tabCounts(0,{you:0,waiting:2,ready:0}).th.tone` → `'wait'`; `tabCounts(0,{you:0,waiting:0,ready:0})` → `{q:0, th:null}`; `tabCounts(1, null)` → `{q:1, th:null}`; `tabCounts('x', {you:-1})` → `{q:0, th:null}`. `heldPill({goals:{run:2,drain:0,park:9}}).text` → `'Partly parked · 2 of 11 goals running'` with title `'9 parked, 0 draining'`; `{run:0,drain:3,park:8}` → text `'Partly parked · 0 of 11 goals running'`; `{run:5,drain:1,park:0}` → word `'Partly draining'`; null for `{run:11,drain:0,park:0}`, `{run:0,drain:0,park:4}`, `{run:0,drain:0,park:0}`, `{run:-1,drain:2,park:2}`, `{run:'2',…}`, a missing `goals`, `null`. `held: [{title:'Recurring checks', mode:'park', why:'waits on your approval'}, {title:'Sense', mode:'drain'}]` → title `'Recurring checks: waits on your approval\nSense: drain'`; 25 held entries → 20 lines; a title holding `‮` comes out with it replaced. `machineMode(['run','run'])` → `{mode:'run', counts:{running:2,draining:0,parked:0}}`; `['run','park','drain']` → mode `'mixed'`, counts 1/1/1; `[]` → mode null. `hubKey('settings', false, 'abc123')` → `'settings-abc123'`; `hubKey('alpha', false, 'x')` → `'alpha'`; `hubKey('alpha', true, 'x')` → `'alpha-x'`.
- [ ] **Step 2: Run them and see them fail** (`node --test --test-concurrency=2 --test-name-pattern="Overview's rules" test/hub-overview.test.mjs` → fails: the block isn't marked).
- [ ] **Step 3: Write the block and switch `keyOf` to `hubKey`.** The block uses nothing outside itself except `tLine`; the vm loader also slices the one-line definitions of `T_UNSAFE` and `tLine` from the page and runs them before the block (a bidi case proves `T_UNSAFE` is there).
- [ ] **Step 4: Run the tests, plus `test/dashboard-shell.test.mjs`** (all pass).
- [ ] **Step 5: Commit** `kit-94: T1 the Overview's pure rules`.

### Task 2: the shell, the tabs and the cards

**Files:** Modify `docs/devteam/dashboard/hub.html` (CSS after the block; body/header markup; `paintTab`, `overviewCard`, `paintOverview`, `mosaic` caller, a new `cardMenu`). Test: `test/hub-overview.test.mjs` (a fixture hub, new Chrome tests).

**Consumes:** T1's functions; the shell's `PULSE_STATES`, `statusPill`, `escHtml`.
**Produces:** a test helper `fixtureHub(t, { instances, box, dashboards })` in hub-overview.test.mjs returning `{ url, setList(list), asks(port) }`. It is one `http.Server` on a free port that serves `/` (hub.html read fresh), `/instances.json` (`{ hub: 1, kit, instances }`, mutable through `setList`), `/box.json` (the given object, or 404), and 404 for anything else. Per stand-in dashboard, a second server on the instance's port serves a page whose script answers `{devteam:'hub-fleet', mode, nonce}` from its parent with `{devteam:'hub-fleet-done', nonce, ok:true}` (or the configured error), records each ask by `fetch('/asked?mode=…&all=…')`, and records its own `location.hash` on load and on `hashchange` by `fetch('/hash?h=…')`. `asks(port)` returns the recorded asks and hashes. Cleanup goes through the file's `defer`. Fixture hellos are built by a `hello(name, port, over)` helper with sane defaults (`inbox: 0`, `threads: {you:0,waiting:0,ready:0}`, `fleet: {mode:'run', workers:1}`, a `pulse` with `state`, `activity` of 84 zeros, `attention: []`, `open_tickets`, `done_tickets`, `blocked_tickets`, `goals_open`, `goal`, `last_activity`, `working`).

Markup and CSS decisions:
- `<body class="shell">`. `#tl` and every `iframe` (dashboard frames and the terminal frame) get class `no-shell`. `#ov-body` gets `class="page"`. `#notify` and `#box-links` leave the header (T4 re-homes them; until then they move unattached into a hidden holder `<div id="hub-later" hidden>`, so the notify code still runs).
- Remove the hub's rules for `.ov-head*`, `.pill*`, `.seg*`, `.ov-ctl*`, `.ov-card.bad/.warn`, `.ov-grid`, `.ov-ok`, `.ov-box*`, `.ov-head .acts button*`. Keep `.ov-stats` (now `repeat(2, minmax(0,1fr))`), `.ov-stat*`, `.ov-att*`, `.ov-mosaic*`, `.ov-bar*`. New: `.ov-card.blocked { border: 1px solid var(--red); box-shadow: 0 0 0 1px color-mix(in srgb, var(--red) 25%, transparent); }`, `.hub-body { display:flex; flex-wrap:wrap; gap:12px 16px; align-items:flex-start; }` with `.ov-stats { flex: 1 1 200px; }`, `.hub-goal` (a flex row that wraps: title truncates, `+N more`, the bar `flex: 1 1 120px`, its words), `.card-head .pill { flex: none; }` and, for the two pills whose words are in `span.t` (Partly blocked, partly held), `.card-head .pill.shrink { flex: 0 1 auto; min-width: 0; overflow: hidden; } .pill.shrink .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }`, `.hub-why`, `.tab .dot`, `.tab-counts .n.q { color: var(--red-fg) }`, `.n.th.ok { color: var(--green-fg) }`, `.n.th.you { color: var(--blue-fg) }`, `.n.th.wait { color: var(--muted) }`, `.menu-pop` (fixed, as the mock's). `#overview` keeps `position:absolute; inset:0; overflow:auto` and loses its padding (the page pads).
- Tabs: `paintTab(it)` writes `span.dot.<tone>[.pulse when red]`, `span` name, `span.tab-counts` built from `tabCounts` (q in `.n.q`, the `·` in `.dim`, th in `.n.th.<tone>` with its title); `tab.title = PULSE_STATES[stateOf(it)].label`. `tabsEl` is in a `.shell` header, so the block's dot styles and reduced-motion rule apply.
- Card: as the spec, built with `el()`. The head is `div.card-head`: `button.ov-name.grow` (pin name, `data-k="<root>:name"`), the pills (`pill amber` Partly blocked with `span.t`; `a.pill.amber.held-pill` from `heldPill` with `href="#"`, `title`, `data-held`; then the status pill kept exactly as today, `el('span', \`pill ${S.tone}\`, S.label)` with `S = STATES[st]` (test/dashboard-shell.test.mjs:319 holds the hub to that line; it is short and doesn't shrink), pin `state`), then `button.end.menu-btn` "⋯" (`aria-label="More"`, `data-menu`). Body, goal line, attention and old-kit line as the spec. The `.foot` holds T3's switch (empty in T2). A delegated click on `#ov-body`: a click inside `.card` that isn't on `a, button, .fleet-switch, .menu-pop` selects that card's root. The Inbox stat button calls `openAt(root, '#overview?th=inbox')`; the held pill calls `openAt(root, '#goals')` with `preventDefault`.
- `openAt(root, hash)`: `frameFor(it)`. If the frame was just made, its `src` is `urlOf(x) + hash`; else `it.frame.src = urlOf(x) + hash` (a fragment-only navigation). Then `select(root)`.
- `cardMenu(btn, it)`: one `.menu-pop` appended to `body`, placed under the button, holding `div.mi` (root, port) and two buttons, "Open its dashboard" (`select`) and "Open in a new tab" (`window.open(urlOf(x), '_blank', 'noopener')`). It closes on Escape, an outside `pointerdown` and at the start of `paintOverview`.
- Header: `h2` "This machine" (pin headline), `.sum` (pin summary; "No projects running" with none), `.acts` empty in T2 (T3 fills it).

- [ ] **Step 1: Write the failing Chrome tests**, all against `fixtureHub` at 1440x900 unless said:
  - `'the Overview: a header, then two cards a row with the standard head'`: three projects. `.ov-head h2` reads `This machine`; `.sum` is `3 projects · 1 moving · 1 waiting on you · 1 blocked`. No button's text is `Park all` or starts with `Resume all`. `.ov-card` count is 3, each `.c6`, cards 1 and 2 share a top. Each head's last element child is `.menu-btn`, and its `.pill` includes the status words (`Building`, `Waiting on you`, `Fully blocked`). There is no element `.ov-goals`, and one `.hub-goal` per answering card. A click on a card's mosaic selects its tab (`[role=tab][aria-selected=true]` text starts with its name) and shows its frame; a click on ⋯ opens `.menu-pop` with the root and selects nothing.
  - `'the tabs: a dot by state, the state word, the Inbox counts'`: projects in building, moving, waiting, blocked, parked and (after `setList` drops it, the tab persisting for 30 s) gone. Expect dot classes `green`, `blue`, `amber`, `red pulse`, none, `red pulse`, and titles `Building`, `Moving`, `Waiting on you`, `Fully blocked`, `Parked`, `Not answering`. Counts: inbox 3 with threads 1/1/1 gives `.n.q` `3` and `.n.th.ok` `2`; you 2 gives `.n.th.you` `2`; waiting 2 gives `.n.th.wait`; all zero gives no `.tab-counts`. The Overview tab text is exactly `Overview`. Under `Emulation.setEmulatedMedia` with `prefers-reduced-motion: reduce`, the red dot's computed `animation-name` is `none`, and without it, `shell-ring`.
  - `'a fully blocked card: red border, head divider in --line; the Inbox stat as the tab'`: the blocked card's computed `border-top-color` equals a probe element's computed `color` under `color: var(--red)`, its `.card-head` `border-bottom-color` equals a probe's `var(--line)`, and a building card has no `blocked` class. The Inbox stat's `.tab-counts` HTML equals its tab's. Clicking the stat selects the project, and the stand-in records hash `#overview?th=inbox`.
  - `'the gap audit rows: top goal +N more and its bar, kit behind in amber, not answering, an old kit'`: goal title shown with `+2 more` (goals_open 3); `.ov-bar` with `aria-valuenow` = done_tickets and words `3 of 8 merged · 2 waiting on you`. Kits `v0.50.0` and `v0.52.0` make the first `.amber` with a title naming `v0.52.0`. The gone card has pill `Not answering`, class `blocked` and attention starting `Its dashboard stopped answering at`. A hello without `pulse` but with `inbox: 0` shows `.hub-why` `Update its kit to see what it is doing`, with no `.ov-stats`, no `.hub-goal` and no `.fleet-switch`.
  - `'the partly-held pill: words, hover, a click to Goals'`: `fleet.goals {run:2,drain:0,park:9}` gives `.held-pill` text `Partly parked · 2 of 11 goals running` and title `9 parked, 0 draining`. With `held` given, the title lists them. Clicking it selects the project with stand-in hash `#goals`. A project without `fleet.goals` has no `.held-pill`.
  - `'720px: two cards a row, the body wraps inside each'`: at 720x800 the two cards share a top, and every element in `.hub-body` has its right ≤ its card's right.
  - `'390px: a long name and three pills stay in the head'`: a 40-character name with partly blocked plus held. At 390x844, every `.card-head` child's right ≤ head's right, and `#overview.scrollWidth <= clientWidth`.
  - (string, replacing `'the Overview draws the box line from box.json and the latest list'` for now) `'the Overview draws no box line'`: `paintOverview`'s body doesn't mention `boxLine`, `findBox` keeps `image: b.image`, and `draw` keeps its two `hubSeen` lines. T4 adds the Settings half.
- [ ] **Step 2: Run, see them fail** (Node 24, the file filtered by `--test-name-pattern`).
- [ ] **Step 3: Implement** as decided above.
- [ ] **Step 3b: In `test/dashboard-shell.test.mjs`, change only the loop `for (const [name, src] of [['index.html', INDEX], ['hub.html', HUB]])` that asserts "has no .shell yet" to run over `[['index.html', INDEX]]`, with a comment that the hub adopted the shell in kit-94; the keyframes check in that loop keeps running for both pages (split it into its own loop over both).**
- [ ] **Step 4: Run these tests, the T1 tests, `test/dashboard-shell.test.mjs`, and `test/operator-threads.hub.test.mjs`.** On the box, if that last one fails on the hard-coded `/opt/devteam` paths (lesson k-20261114-204646621), note it and rely on CI.
- [ ] **Step 5: Commit** `kit-94: T2 the shell, tabs and cards`.

### Task 3: the switches

**Files:** Modify `docs/devteam/dashboard/hub.html` (`fleetControl` replaced by `switchEl(key, opts)`, machine switch in the header, `setFleet` busy/error into the state map, `confirming`/`confirmed`/`isConfirming` replaced). Test: `test/hub-overview.test.mjs`.

**Consumes:** `fleetSwitch`, `bindFleetSwitch` (shell); `machineMode`, `heldPill` (T1); `setFleet(roots, mode)` (today's).
**Produces:** `const sw = new Map()`, holding key → `{ confirming: 'park'|'run'|null, until, busy, error }`. Also `switchEl(key, { scope, mode, counts, runConfirm }) -> HTMLElement`, which returns `div.sw` holding the builder's HTML, post-processed:
- each `[data-fleet]` gets `data-k="<key>:<mode>"`;
- when `sw.get(key).confirming === 'run'`, the Run button text becomes `Run every goal?` with class `confirm` and `data-confirm="1"`, and the `.fleet-switch` gets `data-confirming="1"`.

It is bound with `bindFleetSwitch(div, { onPress, onConfirm, onCancel })` closing over the key:
- `onPress(m)`: `m === 'park'` sets `confirming: 'park'`; `m === 'run' && runConfirm` sets `confirming: 'run'`; the current mode (pressed) does nothing; otherwise `post(key, m)`.
- `onConfirm(m)`: clears confirming, then `post(key, m)`.
- `onCancel()`: clears confirming.

Each set or clear repaints at once (`paintOverview()`); a set records `until = now + 5000` and also schedules `paintOverview` after 5.1 s; a stale confirm reads as null. `post(key, m)` maps the key to its roots: a root gives `[root]`; `machine` gives the steerable roots with `modeOf !== 'run'` for run, `=== 'run'` for drain and `!== 'park'` for park. It sets `busy` (row: `Parking…`/`Draining…`/`Resuming…`; machine: `Parking N projects…`, `Draining N projects…`, `Resuming N projects…`), calls `setFleet(roots, m)`, then sets `error` to the first failure (machine: `"<name>: <error>"`) or clears it. Row busy also follows today's `fleetBusy` (a machine op disables the cards' buttons). `setFleet` stays the one place that asks the dashboards. The row wrapper carries pin `fleet` (`pinOn(div, 'fleet', \`Fleet: ${mode}\`)`), as today's control did.

Test discipline for modes (`fleetSet` makes `modeOf` prefer what the hub just set for 30 s, hub.html:867-874): after a recorded ask, the test calls `setList` with the mode the project now has, so the hello agrees and `fleetSet` lets go on the next `draw()`; a scenario that starts from a different mix reloads the page first, so `fleetSet` is empty.

- [ ] **Step 1: Write the failing Chrome tests** (`fixtureHub`; the stand-ins' `asks()`):
  - `'the machine switch: shared mode, Mixed, Park confirms with the count, Run resumes all, Escape cancels'`: two running projects show the machine switch's `[data-fleet=run][aria-pressed=true]` and the label `Every fleet`, beside `a.set[href="#settings"]` with text `Settings`. Focus Park, press space: the button reads `Park 2 projects?` and has focus. Call `paintOverview()`; it still has focus. Press Escape: it reads `Park` and no ask was recorded. Press space twice: both stand-ins record `park` with `all=true`. With the list made one park and one run, the label reads `Mixed: 1 running, 0 draining, 1 parked` with no button pressed. Run records `run` at the parked one only. A stand-in set to fail shows `.err` starting with its name.
  - `'a card's switch: Park confirms, busy, error; pressing the current mode does nothing'`: Park, then `paintOverview()`, then space keeps focus on `Confirm park`. A second press records `park` and shows the busy line `Parking…` while the stand-in delays 1 s. A failing stand-in shows `.err`. Pressing pressed Run records nothing.
  - `'a partly held card: Run asks "Run every goal?" in place, posts on the second press, Escape cancels'`: fleet mode `run` with the pill. First Run press: the text is `Run every goal?`, `.fleet-switch[data-confirming="1"]`, nothing recorded. Escape returns it to `Run`. Two presses record `run`. The same with fleet mode `park` and the pill: the first press confirms too.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** Drop the old `confirming` Map helpers. Keep `fleetBusy`/`fleetSet` semantics inside `setFleet`.
- [ ] **Step 4: Run T1–T3 tests and `test/dashboard-shell.test.mjs`.**
- [ ] **Step 5: Commit** `kit-94: T3 the switches`.

### Task 4: the hub's Settings

**Files:** Modify `docs/devteam/dashboard/hub.html` (a `section#settings-view` on the shell; `paintSettings()`; `showOnly`/`select`/`hashchange`/`draw()` learn `SETTINGS = '\u0000settings'`; `findBox` stores `box.passkeys`, `box.previews` and builds the links into Settings rows instead of `#box-links`; `#notify` moves into the New Inbox items row; a test button). Test: `test/hub-overview.test.mjs` (replace `'the Overview draws the box line from box.json and the latest list'` with a Settings wiring check; new Chrome test).

Decisions:
- Markup: `<section id="settings-view" hidden aria-label="This machine's settings"><div id="hub-settings" class="page"></div></section>` in `main`, styled like `#overview`. `paintSettings()` rebuilds the This machine rows each `draw()` while it shows. The Notifications row's value cell is the persistent `#notify` span (moved, never rebuilt), so `notifyControl`/`pushControl` keep writing there.
- This machine on a box reads `boxLine(box?.image ?? null, hubSeen)`'s parts: part 0 is "Box release", value its text without the leading `Box `; part 1 is "Hub", value its whole text, amber when `amber`; each later part is a tool, split at its last space into name and version.
- Row builder `setRow(name, key, valueNode, desc, yours)` → `div.rowline.set-row` (`span.t` name + `code.set-key`; `span.r` value + `span.badge.amber` "yours to change") followed by `div.set-desc`. Groups via `div.sec` > `div.lbl` + `div.rows`. CSS for `.set-row`, `.set-key`, `.set-desc` (max-width `var(--measure)`), `.badge.amber` as the mock's, with the ≤700px wrap.
- Descriptions (exact): Box release "the box image this machine runs"; Hub "the kit whose hub you are reading; each project keeps its own kit"; a tool "the version on this box"; Hub served by kit "the kit whose hub you are reading; each project keeps its own kit"; Passkeys "the keys that may open this hub and its dashboards; add one per device, remove a lost one"; New Inbox items "a notification on this device when any project asks you something"; Test "send one now, to see that this device gets them"; Previews "the live previews this box runs for drafts".
- When the browser can't notify (`!NOTIFY_OK` on a laptop), `notifyControl` writes "This browser can't notify from this page" into the row instead of nothing; the box's own lines (blocked, unavailable, Add to Home Screen) stay. A string test checks that the sentence is in the page.
- Test notification: on a box, the existing push-test fetch moves from the "Notifying you…" button to a `Send a test` button in the Test row, shown when subscribed. On a laptop with permission granted, `new Notification('devteam', { body: 'A test notification from this hub' })`. The Test row shows only when notifications are on.
- `select(SETTINGS)`: `history.replaceState(null, '', '#settings')`, `showOnly(SETTINGS)` (every tab `aria-selected=false`, `#tl` hidden, `tlLeave()`), `paintSettings()`. `draw()`'s pick: `want === 'settings'` gives `select(SETTINGS)`; keep it on later draws. The link `a.set` click sets `location.hash = 'settings'`; `hashchange` handles it. `draw()`'s `empty.hidden` treats Settings as it treats the Overview (no "No devteam dashboards" text under Settings).

- [ ] **Step 1: Write the failing tests:**
  - (string) `'Settings draws the box line from box.json and the latest list'`: `paintSettings` contains `boxLine(box?.image ?? null, hubSeen)`; `findBox` keeps `image: b.image`; `draw` keeps the two `hubSeen` lines it checks today; no `innerHTML` in `paintSettings`; `paintOverview` doesn't mention `boxLine`.
  - (Chrome, laptop at 127.0.0.1) `'Settings on a laptop: from the link only, This machine and Notifications'`: no tab text `Settings`. Clicking `a.set` gives hash `#settings`, `#settings-view` shown, `#overview` hidden, no tab selected, `#tl` hidden. `.sec .lbl` texts are exactly `This machine`, `Notifications`. Row `Hub served by kit` with key `hub` and the list's kit. `New Inbox items` carries `yours to change`. Each row is followed by a `.set-desc`. There is no `.ov-box` and no text `Box v` on the Overview. Reload at `/#settings` with a listed project named `settings`: Settings shows, and that project's tab key is `settings-<hex>`. After 11 s (one `draw()`), Settings still shows. The Overview tab brings the Overview back.
  - (Chrome, box at `http://hub.localhost:<port>/`, box.json with `box:1`, `terminal`/`instance`/`passkeys`/`previews` on `*.localhost`, `image: {release:'v0.57.0', tools:{'claude-code':'2.4.1'}}`, list `image: true, kit: 'v0.57.0'`) `'Settings on a box: Signing in and Serving, boxLine's parts'`: groups `This machine`, `Signing in`, `Notifications`, `Serving`. Rows `Box release` = `v0.57.0`, `Hub` = `hub v0.57.0`, `Claude Code` = `2.4.1`. `Passkeys` has a link `Manage` to the passkeys URL and `yours to change`. `Previews` has a link with text `Previews`. The Terminal tab is still present. If headless Chrome can't load `hub.localhost` (navigate there and check `document.title === 'devteam'` within 10 s), the test skips with that reason.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run T1–T4 tests, `test/dashboard-shell.test.mjs`, and `test/gateway.test.mjs` (string tests; one file, concurrency 2).**
- [ ] **Step 5: Commit** `kit-94: T4 the hub's Settings`.

### Task 5: the measure and the real dashboards

**Files:** Modify `test/hub-measure.test.mjs` (`PAGES`), `test/hub-overview.test.mjs` (the real-dashboards test), and `hub.html` only where the measure finds a defect.

- The Overview and Settings scroll inside `#overview` and `#settings-view` (`overflow: auto`), so the measure's overflow check would skip all of it. Each page's `ready` first sets that box's `style.overflow = 'visible'` (the page is short enough not to need to scroll in the fixture) and then waits for its content, so `overflow` is checked inside it.
- `PAGES = [{ path: '/#overview', ready: "(document.getElementById('overview').style.overflow = 'visible', document.querySelectorAll('.ov-card').length > 0)", opts: { view: '#ov-body', bar: 'header', ignore: '#tl, iframe' } }, { path: '/#settings', ready: "(document.getElementById('settings-view').style.overflow = 'visible', !document.getElementById('settings-view').hidden)", opts: { view: '#hub-settings', bar: 'header', ignore: '#tl, iframe' } }]`. The loop measures at the default `SIZES` (1440x900, 720x800, 390x844). Drop the smoke branch (the list is no longer empty) but keep its assertions about sizes for the first page.
- The real-dashboards test (`'the Overview in Chrome: Park by keyboard, …'`) is renamed `'the Overview in Chrome: Park by keyboard on a card, the machine switch\'s Park and Run through each dashboard; nothing but the hub above a dashboard is heard'`. The card part stays, with its selectors moved to `.fleet-switch [data-fleet=park]` in the card and `Confirm park`. The pressed check becomes `[data-fleet=park][aria-pressed=true]` and the card's status pill `Parked`. "Park all" becomes the machine switch: Park, then `Park 1 project?`, and beta parks. "Resume all (2)" becomes the machine switch's Run, and both run. The security half is unchanged.

- [ ] **Step 1: Edit the measure list and the real-dashboards test.**
- [ ] **Step 2: Run `test/hub-measure.test.mjs`** (Node 24). Fix each layout failure in hub.html's page CSS (never in the blocks) until clean at three sizes.
- [ ] **Step 3: Run the real-dashboards test** (Node 24, name pattern).
- [ ] **Step 4: Run every touched file once more, one at a time:** `test/hub-overview.test.mjs`, `test/hub-measure.test.mjs`, `test/dashboard-shell.test.mjs`, `test/gateway.test.mjs`, `test/operator-threads.hub.test.mjs` (box-path caveat as T2). Look at the Overview and Settings in Chrome screenshots, light and dark, at 1440 and 390 (`Page.captureScreenshot` into the ticket's `shots/`, committed for the final reviewer and the supervisor).
- [ ] **Step 5: Commit** `kit-94: T5 the measure lists the Overview and Settings; the real-dashboards test on the machine switch`.

## Then

Verify (verification.md, a row per done-when, CI run id at the head via `gate ci -- gh run watch …`), merge `origin/main`, push, open the PR, final review by a fresh subagent that hasn't seen the build, `check-ticket`, merge-request.

## Notes

- A project named `settings`, `overview` or `terminal` now gets a `-<hex>` address (T1). The gateway's push links follow the old rule, so a notification for such a project would open the view instead. That's rare, and the gateway is outside the touches: an observation for a follow-up (plan review 1, P13).

## Rulings

- `m-20261116-022459643-supervisor`: the partly-held pill is drawn from `fleet.goals`' counts. Its hover lists `fleet.goals.held = [{ title, mode, why }]` when present, else the counts. Both are tested (T1, T2).
- `m-20261116-023526852-supervisor`: approve-spec at 25d12f1.
- `m-20261116-024531651-supervisor` (on `m-20261116-024443642`, plan review 1 P1): `test/dashboard-shell.test.mjs` is in the touches, for its "no .shell yet" loop only (T2 makes it check index.html alone; nothing else in the file changes). Order: kit-94 follows kit-87, and kit-100 follows kit-94. Keep building; merge `origin/main` once kit-87 has merged, then open the PR.
- Spec review 2's S2-1 and S2-2 are carried here: Escape and focus on both confirms (T3), the 0-running mixed pill and Run confirming on a pill card not in run (T1, T3), and the reserved-key suffix (T1, T4).
