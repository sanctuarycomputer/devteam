# kit-83: the dashboard shell contract

Ticket `kit-83-dashboard-shell-contract` (kind `contract`, size M, risk normal), feature `dashboard-cleanup`, design `project/designs/a-cleaner-more-consistent-dashboard.md` (home), section `dashboard-shell@1`. It provides `docs/devteam/dashboard/shell.md@1`. Builds on `kit-82` and `kit-236`, both merged on main at `ad139e1`.

## Why

The cleanup's page tickets (`kit-87` to `kit-96`) run one at a time on a 6,000-line page, and `kit-94` restyles the hub beside them. They can only stay small and parallel in spec and plan if the shared parts exist first, complete, and stay frozen: one layout CSS block and one JS block, byte-identical in `index.html` and `hub.html`, plus the URL grammar as pure functions. This ticket lands those blocks, the contract that says how to use them (`shell.md`), and the measure check that every page ticket adds its pages to. It changes nothing the owner sees today.

## How it works today (kit main `ad139e1`)

- `index.html` (6,004 lines) and `hub.html` (1,460) each hold their CSS and JS inline. Both start their `<style>` with the `devteam-ui tokens` marker block, which `test/lib/chain.mjs` keeps equal to `devteam-ui.css`. Marker blocks are `/* <name> start */` … `/* <name> end */`; tests cut them out and run them in `vm`.
- **Class names the mock uses are already taken by today's pages, with other styles:** `.seg` (index: a label wrapper; hub: today's segmented control, pressed = inverted), `.pill` (hub: the status pill; index: `badge pill` ticket pills), `.card`, `.card-head` (index: padding-sized, not 41px), `.steps` (index's step bar), `.ov-head` (hub), `.brand .dot` (index), `.drawer` (index's peek). `--measure` is `78ch` on index.
- `index.html` has a `goalSteps(g, s, R)` (2177; static labels Defined, Designed, Approved, Built, Met) used by the goal card and goal peek.
- `hub.html` has `STATES` (386: label, tone, rank per pulse state) used by `stateOf`, `overviewCard` (DOM, `el('span', 'pill ' + tone, label)`) and the sort.
- `route()` (3843) reads today's link heads: `preview/`, `artifact/`, `review/`, `review-preview…`, `ticket/`, `q/`, `goal/`, `planner/`, `talk/`, `file?…`, and the `PEEKS` map's kinds (feature, story, release, wave, milestone, act, decision, retro, lesson, problem, thread, sensor, observation, signal, learning). Sections are anchors: overview, goals, inbox, progress, board, library, loop, trust, retros, health, monitoring.
- `test/lib/chrome.mjs` drives headless Chrome (needs Node 20+ for `WebSocket`; CI runs 18, 20, 22, 24, so 18 skips Chrome tests). The mock carries `measureCheck()` (`artifacts/dashboard-cleanup/index.html` ~1915), the check the design says the kit's test runs.

## What changes

### 1. `docs/devteam/dashboard/shell.md` (new; says `dashboard-shell@1`)

The contract, defining what the design's `dashboard-shell@1` lists, in this order: adopting the shell (the `.shell` scope, below); page registration; page heads `#<page>[?state]` with every state key; today's link heads, each kind's home page and the redirects, as the router's own table outside the block, passed to `parseHead`; `history.state` and closing a peek; remembered filters; each builder's input and output, each binder's callbacks, `threadsTabs.register`; every token (`--page-max`, `--page-top`, `--page-pad`, `--header-pad`, `--panel-pad`, `--head-h`, `--backdrop`, `--gap`, `--ease`, `--dur`, `--threads-w`, `--bar-h`, `--measure`); `.g12` and its spans, `.cards`; the measure check and how a ticket adds its pages. It says both blocks are complete here and no ticket before `kit-95` changes them (a ticket that must takes `hub.html` and an edge with `kit-94`, re-planned through the supervisor). Its fake is the real components: the blocks and `test/fixtures/dashboard-shell.html`.

### 2. The `devteam-layout` CSS block (both pages, byte-identical)

Placed in each page's `<style>` right after the tokens block, so each page's own CSS comes after it.

- **Tokens** on `:root`, the mock's values: `--page-max: 1200px`, `--page-top: 42px`, `--page-pad: 32px`, `--header-pad: 16px`, `--panel-pad: 16px`, `--head-h: 41px`, `--backdrop: rgba(0,0,0,.7)` (with a 4px blur where used), `--gap: 16px`, `--ease: cubic-bezier(.32,.72,0,1)`, `--dur: 280ms`, `--threads-w: 380px`, `--bar-h: 49px`, `--measure: calc((var(--page-max) - 2 * var(--page-pad) - 11 * var(--gap)) / 2 + 5 * var(--gap))` (560px), and below 900px `--threads-w: 100vw`.
- **Scoped, so today's pages can't change.** Every other selector in the block sits under `:where(.shell)`: it styles only inside an element with class `shell`, and with the specificity of the bare selector, so a page's own later rule of equal weight wins. Neither page has a `.shell` element today, so no element on today's pages matches a block rule. The one token a page already sets, index's `--measure: 78ch`, comes after the block and keeps winning there until a page ticket removes it. This lets the block use the mock's own names (`.card`, `.card-head`, `.seg`, `.pill`, `.dot`, `.steps`, `.ov-head`, `.drawer`…), which the page tickets port from the mock. `shell.md` says how a region adopts it: put `shell` on the region, and remove or narrow the page's own rules for the same names in that ticket, so one rule styles each thing.
- **Contents** (ported from the mock, which the owner settled): `.g12` with `.c2`–`.c12` (below 1100px `.c2`/`.c3` span 4, `.c4`–`.c7` 6, `.c8`/`.c9` 12; below 560px every span 12) and `.cards` (`repeat(auto-fill, minmax(min(22rem, 100%), 1fr))`, stretched cards as flex columns, footer `margin-top: auto`); the page bar (`.pagebar`, `--bar-h` tall, `--header-pad` at both ends, title left, `.tt` (the Inbox button) pinned right); the page body (`.page`: `--page-max`, `--page-pad`, first content at `--page-top`); `.card`, `.card.small`, `.card-head` (`--head-h` tall in every card, small ones included; `--line` bottom border; trailing actions `margin-left: auto`) and a table in a card starting below the head's border; the sectioned status (`.ov-head`, `.sec`, `.lbl`, `.rows`, `.rowline`, `.dot` and its tones and pulse, `.pill` and its tones); the tab bar (`.tabbar`, its underline shown with no transition), the record table (`.db-t`, `.cell`, "None" when empty), the properties table (`.props`, monospace keys, rules between rows only), the segmented control (`.seg`, every button 28px), the fleet switch (`.fleet-switch`), the step bar (`.steps`, today's look), the heartbeat (`.heartbeat`, `.hb-labels`); the peek frame (`.drawer`, `.drawer-head` `--bar-h` tall, `--panel-pad`, sliding with `--ease`/`--dur`, and `.scrim` in `--backdrop`); the Threads list rule (`--line-2`); the reduced-motion rule (`--dur: 0ms`, no pulse).

### 3. The `devteam-shell-js` block (both pages, byte-identical, run in `vm`)

Placed at the top of each page's main `<script>`. It declares only top-level names neither page declares (checked by its test against both pages), touches no DOM at load, and references only standard APIs and its own `escHtml`. Builders return HTML strings; binders take a root and callbacks through delegated listeners that survive a redraw.

- `escHtml(s)`.
- `tabBar({ tabs: [{ id, label, count?, waiting?, disabled? }], selected })`: `role=tablist`, each tab a `role=tab` button with `data-tab`, `aria-selected`, roving `tabindex` (0 on the selected, -1 else), `aria-disabled` when disabled; a count in `.n`, blue (`.n.blue`) when `waiting`. `tabStep(tabs, fromId, key)`: the id ArrowRight/ArrowLeft/Home/End moves to, wrapping, skipping disabled tabs (null for any other key). `bindTabBar(root, { onSelect })`: a click on an enabled tab, or an arrow/Home/End key, calls `onSelect(id)` and then focuses that tab in `root` (after the page's redraw, if it redraws synchronously).
- `dbTable(cols, rows, { sort })`: `cols` are `{ label, key? }` or strings, `rows` arrays of cell HTML (or `{ cells, sort: [...] }` with sort keys per cell); `sort` is `{ col, dir }` (`dir` 1 or -1) or null. Rows are sorted numeric-aware (`localeCompare(…, { numeric: true })`, so 2 before 10) and stable; each `<tr>` has `data-row` = its index in `rows` as passed, `tabindex=0`; each header is a sort button with `data-col` and `aria-sort`; each cell's content sits in `.cell`; an empty `rows` draws one "None" row. `nextSort(sort, col)`: the same column reverses, another starts ascending. `bindDbTable(root, { onSort(col), onOpen(rowIndex) })`: a header click calls `onSort`, a row click or Enter on a focused row calls `onOpen(Number(data-row))`.
- `props(rows)`: `[[key, valueHtml, tip?]]` → a `<dl class="props">`, a tooltip on a key when given.
- `goalSteps({ step, built, met })`: the step bar, steps Defining, Planning, Waiting on you, Built, Met, each word following its state (ahead / now / done: Defining/Defining/Defined, Planning/Planning/Planned, Approval/Waiting on you/Approved, Built/Building/Built, Met/Met?/Met); `step` 0–5 (5 = all done); `built` and `met` are `{ frac, text, title? }` or null, drawn as today (a filled share on a step not yet reached, a status line under it).
- `heartbeat(days)`: 14 (or however many given) cells, oldest first, today last; each day `{ day: 'YYYY-MM-DD', items: [string], failed: bool }` (the shape `kit-84`'s `upkeep_days` follows); shade `l1`–`l4` by item count, `bad` when failed, empty on a quiet day; a hover title listing that day's items; the first day's date and "today" under it.
- `PULSE_STATES` and `statusPill(state)`: the hub's table, moved here (label, tone, rank); `statusPill` returns `<span class="pill <tone>">label</span>`, an unknown state as `unknown` (Running). `hub.html`'s `STATES` becomes the block's table, so the hub draws exactly as today.
- `fleetSwitch({ scope, mode, counts: { running, draining, parked }, confirming, busy, error })`: scope `project` (label Fleet), `row` (no label) or `machine` (Every fleet); `mode` run, drain, park or mixed (no segment pressed, label "Mixed: n running, d draining, m parked"); `confirming` swaps Park for its confirm ("Confirm park", or on the machine "Park N projects?" from `counts`); `busy` disables the segments and shows its line; `error` shows in `.err`. `bindFleetSwitch(root, { onPress(mode), onConfirm(mode), onCancel() })`: a press on Park when not confirming, or on Run/Drain, calls `onPress(mode)`; a press on the confirm calls `onConfirm('park')`; Escape inside a confirming switch calls `onCancel()`. The page owns `confirming`, `busy` and `error` per switch and passes them back on each redraw.
- `registerPage({ id, title, group, icon, count, render })` and `shellPages()`: the page registry (an id registered twice throws). `threadsTabs.register({ id, label, count, render, disabled })`, `threadsTabs.list()`, `threadsTabs.render(id, el)` (a throwing render shows its error in `el`, and the rest keep working).
- **History, pure:**
  - `STATE_KEYS`: `th`, `t` on every page; board `goal`, `feat`, `repo`, `att`; progress `goal`, `narrow`, `show`; library `kind`, `goal`; goals `gt`; sensors `st`; loop `lt`, `kind`, `orient`.
  - `parseHead(hash, routes)`: `routes = { pages: [...ids], links: { kind: home }, files: [[RegExp, home]], redirects: { head: head } }`, supplied by the page. A page head gives `{ page, state }` (only that page's keys, in canonical order); a redirect is followed once and flagged `redirected`; a link head gives `{ link, kind, home }` (`file?` reads `path` for its home: governance, process and strategy paths go to `governance`, else `library`); empty or unknown heads give `overview`.
  - `headFor(parsed)`: back to the hash; `headFor(parseHead(h))` is `h` for every canonical page head and link head.
  - `stampFor(entry, here, cold)`: `entry = { hash, state }` (its `history.state`), `here` = the stamp on screen before it (`{ page, depth }`, or null). An entry with a state keeps it. A page head: `{ page: head, depth: 0, openedHere: !cold }`. A link on a cold load: `{ page: headFor(home), depth: 1, openedHere: false }`. A link from a page: `{ page: here.page, depth: 1, openedHere: true }`; from a peek: `{ page: here.page, depth: here.depth + 1, openedHere: true }`.
  - `closeTarget(state)`: `{ go: -depth }` with `openedHere`, else `{ replace: page }`; never Overview by default.
  - `REMEMBERED` (board `goal`, `feat`, `repo`, `att`; progress `goal`; library `goal`, `kind`; loop none) and `rememberedFilters(page, keys, fresh, stored)`: on a fresh entry (`fresh`) whose head carries none of the page's filter keys (`keys`), the stored values for that page's own remembered keys, else null. `stored` defaults to `devteam.board.filters` from `localStorage`, read in a try (a throwing store gives null). `saveFilters(page, state)` writes the page's own remembered keys.
- **Today's code it touches:** index's `goalSteps(g, s, R)` is renamed `goalStepper` (its two callers too; same output), since the block now owns the name. hub's `STATES` literal is replaced by `const STATES = PULSE_STATES;`. Nothing calls the rest yet.

### 4. The router's table, outside the block (`index.html`, `shell-routes` marker block)

`SHELL_ROUTES = { pages, links, files, redirects }`: the page ids `overview`, `goals`, `inbox` (until `kit-100`), `progress`, `board`, `library`, `trust`, `governance`, `sensors`, `retros`, `loop`, `settings`; every link kind today's `route()` reads with its home (ticket, feature, story, release, wave, milestone, planner, thread → board; goal → goals; q → overview; act, decision, lesson, problem, signal, learning, observation → loop; sensor → sensors; retro → retros; artifact, preview, review, review-preview → library; talk → overview; file by path); redirects `monitoring` → `sensors`, `health` → `sensors?st=fleet`. Unused by today's router (`kit-87` builds the router on it); `kit-93` and `kit-100` edit it.

### 5. The measure check (`test/lib/measure.mjs`)

`measure(page, opts)` evaluates one function in the page and returns its failures (strings, each naming its check). Ported from the mock's `measureCheck()`, with the selectors as options (`view`, `bar`, `prose`, `ignore`), and three checks added. The checks:
1. `prose`: a running-text element (default `p, .ctx, .goal-next, .doc li`, plus the page's own) wider than `--measure`;
2. `overflow`: an element sticking out of its parent's box by over 1px, outside containers whose `overflow-x` is not visible, absolute or fixed elements, and `ignore`;
3. `uneven`: two `.card`s with the same parent and top whose heights differ by over 1px;
4. `head-end`: a `.card-head` whose last item ends short of its content box's right edge;
5. `page-top`: the view's first content's visual top (a tab's text, the first top border, or the first line of text) not `--page-top` below the bar, at scroll 0;
6. `head-h`: a `.card-head` (small cards included) not `--head-h` tall;
7. `header-pad`: the bar's title starting, or its Inbox button (`.tt`) ending, other than `--header-pad` from the bar's ends;
8. `tab-motion`: a `[role=tab]` or its underline (`::after`) with a transition on anything.

`measureAt(chrome, url, widths)` loads a URL at 1440×900, 720×800 and 390×844 and returns the failures per width.

### 6. Tests

- `test/fixtures/dashboard-shell.html` (new): a page built only from the two blocks (cut from `index.html` at test time and inserted, so the fixture can't drift): the tokens, a `.shell` body with a page bar (title, Inbox button), a `.g12` with a `c6` pair, cards of unequal content and a small card, a properties table, a tab bar and a peek frame, each drawn by the block's own builders.
- `test/dashboard-shell.test.mjs` (new): the blocks' equality, the scope, the builders and binders and history functions in `vm`, and the measure self-test in headless Chrome.
- `test/dashboard-measure.test.mjs` and `test/hub-measure.test.mjs` (new): each runs `measureAt` over its page list, empty until the page tickets add to it.

## Acceptance checks (the done-whens)

1. **shell.md** exists, says `@1`, and defines each item of §1 (a test greps for every token name, `.g12`, `.cards`, each builder, binder and history function, `threadsTabs.register`, and the freeze sentence).
2. **`test/dashboard-shell.test.mjs` passes in CI:**
   - the text between `/* devteam-layout start */` and its end, and between `/* devteam-shell-js start */` and its end, is byte-identical in `index.html` and `hub.html`;
   - every block selector but `:root` and the reduced-motion `:root` sits under `:where(.shell)`, and neither page has `shell` in a class attribute or a `classList`/`className` write outside the blocks;
   - the JS block declares no top-level name either page declares outside it;
   - in `vm`: `tabStep` and `bindTabBar` (a fake root) move with ArrowRight/ArrowLeft/Home/End, wrap, and skip disabled tabs, and a click on a disabled tab calls nothing; `dbTable` sorts 2 before 10, reverses on `nextSort` of the same column, shows None when empty, and `bindDbTable` calls `onOpen` with the row's index in `rows` as passed, after a sort too, on a click and on Enter; `goalSteps` renders a fixture per step (0–5, with and without `built`/`met`); `heartbeat` renders an `upkeep_days`-shaped fixture (a quiet day, a busy one, a failed one, today last); `statusPill` renders every `PULSE_STATES` key with the label and tone `hub.html`'s overview card draws for it, and hub's `STATES` is the block's table; `fleetSwitch` renders each mode, mixed, confirming (project and machine), busy and error, and `bindFleetSwitch` calls each callback; `threadsTabs.render` isolates a throwing tab;
   - `SHELL_ROUTES`' page ids and link kinds are disjoint, every page id is free of `/` and `?`, every link kind today's `route()` reads is in it, and every legacy head (each section anchor and each link kind, `file?` for a governance and a library path, `monitoring`, `health`) parses to its home page.
3. **The measure self-test** (in `dashboard-shell.test.mjs`, headless Chrome): every check passes on the fixture at 1440×900, 720×800 and 390×844; the `c6` pair sits side by side at 720; and each of the eight checks fails, by name, on a broken copy of the fixture (one mutation per check: a wide `p`, a child wider than its card, a card stretched taller, a head's last item narrowed, the view moved down, a head made taller, the bar's padding changed, a transition on the tab underline).
4. **`test/dashboard-measure.test.mjs` and `test/hub-measure.test.mjs`** exist and run `measureAt` over their lists (empty now). **Today's pages are unchanged:** besides the test's selector-scope proof, a scratch comparison (verification.md) renders `index.html` and `hub.html` from main and from the branch over the same fixture data in Chrome and finds every element's computed style and box equal.
5. **History functions in `vm`:** `parseHead`/`headFor` round-trip every page head (each page, each state key) and every link head; `stampFor` gives a peek from a page depth 1 and `openedHere`, a peek from a peek depth + 1 and the same page, a cold link its kind's home page, and keeps an entry's own state; `closeTarget` is `go(-depth)` with `openedHere`, else `replace` with the page; `rememberedFilters` applies only on a fresh entry with none of the page's keys, only that page's own keys, and gives null when the store throws.
6. **Every existing test stays green in CI** (8/8 jobs at the head), with today's sections still rendered.

## Contracts

- **Provides** `docs/devteam/dashboard/shell.md@1` (`dashboard-shell@1`). Its fake is the real components: the two blocks and the fixture page.
- **Consumes** nothing new; `upkeep_days`' item shape is defined here for `kit-84` (planned, not started) to follow, and the supervisor is told so with the contract's review request.

## Edge cases

- **A block name a page already uses.** The JS block's names are checked against both pages; `goalSteps` is the one clash today, resolved by renaming index's function. A later page change that declares a block name fails the test.
- **Specificity.** `:where(.shell)` adds nothing, so a page's tuning rule (outside the blocks, after them) wins at equal weight, and a page rule with more weight (`.card.small .card-head` on index) can still override the block inside an adopted region: `shell.md` tells the adopting ticket to remove its old rules.
- **The hub's `STATES`** keeps `rank`, which the sort reads; `statusPill` ignores it.
- **Sort ties and mixed values:** stable sort; a row's `sort` keys win over its cell HTML; HTML is stripped of tags before comparing.
- **A link head with a `/` in its id** (`artifact/main/slug`, `review/…`): the kind is the first segment, the rest is kept verbatim; `headFor` returns it unchanged.
- **`localStorage` throws** (private mode): `rememberedFilters` gives null and `saveFilters` does nothing.
- **Node 18** has no `WebSocket`: the Chrome parts skip there and run on 20, 22 and 24 in CI; the `vm` parts run everywhere.
- **Reduced motion:** `--dur: 0ms` and the pulse stops; the measure's `tab-motion` check holds either way, since the underline has no transition at all.

## Out of scope

- Any visible change to today's pages (the router, the nav, pages, peeks, the hub's cards): `kit-87` onwards. Nothing calls the builders yet but the fixture and tests.
- The follow-on goal's Threads tabs; peeks' own tabs as history entries.
- Copy removal (`kit-95`).

## Rulings

- m-20261115-090246861-supervisor: kit-82 and kit-236 are merged on main; build on them. Any kit run outside the tests gets its own `HOME`, a `DEVTEAM_HUB_PORT` away from 4320, its own port and `DEVTEAM_*` unset (lesson k-20261115-080753394); on the box, run only touched test files at `--test-concurrency=2`.
