# The dashboard shell

Contract `dashboard-shell@1`. Provided by the kit's dashboard (`index.html`) and machine hub (`hub.html`); used by every ticket that rebuilds a dashboard or hub page. It is what the two pages share: one layout CSS block, one JS block, the URL grammar and the measure check.

**Both blocks are complete here.** Every token, style, builder, binder and history rule below lands with this version. Later tickets call them and add their own CSS and JS outside the blocks; no ticket before the copy sweep (`kit-95`) changes either block. A ticket that finds it must change a block takes `hub.html` into its files and an edge with the hub ticket (`kit-94`), re-planned through the supervisor, and bumps this contract.

## 1. The two blocks

| Block | Kind | Where | Rule |
|---|---|---|---|
| `devteam-layout` | CSS, `/* devteam-layout start */` … `/* devteam-layout end */` | each page's `<style>`, right after the `devteam-ui tokens` block | byte-identical in `index.html` and `hub.html` |
| `devteam-shell-js` | JS, `/* devteam-shell-js start */` … `/* devteam-shell-js end */` | the top of each page's main `<script>` | byte-identical in both; runs in `vm` |

`test/dashboard-shell.test.mjs` holds both to that.

**Adopting the shell.** Every rule in `devteam-layout` but the tokens is written `:where(.shell) <selector>` (or `:where(.shell).peek-open …`, `:where(.shell).threads-open …` where it needs the frame's state, below) with `:not(:where(.no-shell, .no-shell *))` on its subject (before a trailing pseudo-element): it styles only inside an element with class `shell` and outside any `.no-shell` region in it, at the specificity of its bare selector, since neither `:where()` nor a `:not()` of one adds any. So nothing on a page changes until it adopts the shell, and it adopts region by region:

1. The first frame ticket (`kit-87`) puts `shell` on `<body>` and `no-shell` on every region it doesn't port: each page's old section, the old drawer and its scrim, the artifact viewer, and the thread layer (`#tl`: the dock, its cards and pins). The hub adopts the same way in its own ticket (`kit-94`): `shell` on its `<body>`, `no-shell` on what that ticket doesn't port.
2. Each later ticket takes `no-shell` off the region it ports.
3. In the same ticket it removes or narrows the page's own rules for any name the block also styles, so one rule styles each thing. Today's pages use some of the block's names for other things: `.card`, `.card-head`, `.seg` (index: a label wrapper), `.pill` (index: ticket pills), `.steps`, `.drawer`, `.dot` (in `.brand`), and the hub's `.ov-head`.

The fence stops block rules from matching inside a `.no-shell` region, but inherited properties (font, line height, colour) still flow into it from a ported ancestor; a ticket that ports an ancestor checks the fenced regions under it still read as they did. A page's own rule after the block wins at equal weight, which is how a page tunes a component for itself. A `.shell` inside a `.no-shell` region isn't supported. The block's one global at-rule is `@keyframes shell-ring`, a name neither page uses.

**The frame's state** sits on the `.shell` element itself: `peek-open` shows the peek (`.drawer`) and its `.scrim`, and `threads-open` shows the Threads sidebar (`.threads`).

**The JS block's names** are global in both pages, so neither page declares any of them outside the block (the test checks).

## 2. Tokens

On `:root`, in `devteam-layout`:

| Token | Value | Meaning |
|---|---|---|
| `--page-max` | 1200px | a page's widest |
| `--page-top` | 42px | from the page bar's bottom to what the eye sees first on every page (a tab's text, a card's top border, or the first line of text) |
| `--page-pad` | 32px | the page's side padding at full width, which `--measure` is computed from; below 900px `.page` pads 16px and the token stays 32px |
| `--header-pad` | 16px | the page bar's padding at both ends: the title's left, the Inbox button's right |
| `--panel-pad` | 16px | the horizontal padding of both side panels: the peek's header and body, and the Threads sidebar |
| `--head-h` | 41px | every card head, small cards included, and the artifact viewer's bar |
| `--bar-h` | 49px | the page bar, the Threads tab bar and the peek's header, so their bottom borders line up |
| `--backdrop` | `rgba(0,0,0,.7)`, with a 4px blur | the one backdrop behind the artifact viewer, a peek and any modal |
| `--gap` | 16px | the grid's gap |
| `--ease` | `cubic-bezier(.32,.72,0,1)` | every slide: the peek, Threads |
| `--dur` | 280ms; 0ms under reduced motion | |
| `--threads-w` | 380px; 100vw below 900px | the Threads sidebar; while it is open, the page's right margin and the peek's `right` |
| `--measure` | half the grid at full width: `(--page-max − 2·--page-pad − 11·--gap) / 2 + 5·--gap`, 560px | the widest running text |

A page that still sets one of these for itself (today `index.html`'s `--measure: 78ch`) sets it after the block, and its value wins there until its page ticket removes it.

## 3. Layout and components (CSS)

All under `:where(.shell)`.

- **Grid.** `.g12`: 12 columns, `--gap`. Spans `.c2`–`.c12`; below 1100px `.c2`/`.c3` take 4 columns, `.c4`–`.c7` 6 and `.c8`/`.c9` 12, `.c10`–`.c12` unchanged; below 560px every span takes 12, so two-up grids hold in the artifact viewer's frame with its threads panel open. `.cards`: `repeat(auto-fill, minmax(min(22rem, 100%), 1fr))`, for cards that hold running text (`.wide` spans the row). Cards in `.g12` or `.cards` stretch to their row's height as flex columns; a `.foot` is pushed to the bottom.
- **Page.** `.pagebar` (the full window wide, `--bar-h` tall, `--header-pad` at both ends; `h1` the title, `.extra` the header's filters, which scroll sideways before they push `.tt`, the Inbox button, pinned right). `.page` (at most `--page-max`, `--page-pad` at the sides, its first content `--page-top` below the bar, a first `.tabbar` or `.ov-head` raised so its text, not its box, sits there).
- **Cards.** `.card`, `.card.small`, `.card.flush` (no padding: a table or properties fill it). `.card-head` is `--head-h` tall in every card, its bottom border `--line`; `.grow` is the one-line title that truncates; `.end` pins a trailing action right. A table or properties right after a head start below its border.
- **Sectioned status.** `.ov-head` (`h2`, `.sum`, `.acts` right), `.sec` (a ruled section: `.lbl`, the monospace label, then its content), `.rows`, `.rowline` (`.t` truncates), `.dot` (`green`, `blue`, `amber`, `red`, `red.pulse`), `.pill` (the same tones).
- **Components:** `.tabbar` (the active tab's underline appears with no transition), `.db-t` (the record table), `.props` (the properties table: monospace keys, rules between rows only), `.seg` (the one segmented control; every button 28px), `.fleet-switch`, `.steps` (the step bar), `.heartbeat` and `.hb-labels`.
- **Frame.** `.main` holds the page bar and the page. While `threads-open` is set, `.main`'s right margin and the drawer's and scrim's `right` are `--threads-w`, so a peek's right edge meets the sidebar's left edge and the scrim covers only the page; below 900px each panel takes the full width.
- **Peek frame.** `.scrim` (`--backdrop`, fading) and `.drawer` (`min(720px, 100vw)` wide, off-screen until `peek-open`, sliding with `--ease`/`--dur`); `.drawer-head` (`--bar-h`, `--panel-pad`, `.end` right), `.drawer-body` (`--panel-pad`).
- **Threads frame.** `.threads` (full height, `--threads-w` wide, off-screen until `threads-open`, sliding with `--ease`/`--dur`); `.threads-head` (`--bar-h`, so its bottom border lines up with the page bar's and the peek header's; a `.tabbar` in it, `.end` for its ×), `.threads-body` (scrolls, `--panel-pad`).
- **Threads list.** `.thread-list`: a `--line-2` rule between items, none after the last.
- **Running text.** `p` and `.ctx` are at most `--measure` wide.
- **Reduced motion.** `--dur: 0ms`, and the red dot stops pulsing.

## 4. Pages

```js
registerPage({ id, title, group, icon, count, render })   // once per page; a second id throws
shellPages()                                               // in registration order
```

`id` is lower-case letters, digits and dashes (never `/` or `?`); `group` is `project` or `autonomy` (the nav's two eyebrow groups; `settings` is reached from the settings area); `icon` an icon name; `count()` the nav count or null; `render(el, state)` draws the page into `el` from its state keys.

The page ids: `overview`, `goals`, `progress`, `board`, `library` (Project); `trust`, `governance`, `sensors`, `retros`, `loop` (Autonomy; `loop` shows as Self Improvement); `settings`; and `inbox` until the Inbox moves into the Threads panel (`kit-100`). They are listed in the router's table (§6), not in the block.

## 5. Builders and binders (JS)

Builders take data and return HTML strings; text is escaped with the block's `escHtml`, and a value documented as HTML is passed through. Binders take a root element and the page's callbacks, through delegated listeners on the root, so they survive a redraw of anything inside it; bind once per root.

| Function | Takes | Gives |
|---|---|---|
| `escHtml(s)` | anything | text with `& < > " '` escaped |
| `tabBar({ tabs, selected })` | `tabs: [{ id, label, count?, waiting?, disabled? }]` | `.tabbar[role=tablist]` of `button[role=tab][data-tab]`, `aria-selected`, roving `tabindex` (0 on the selected), `aria-disabled`; a count in `.n`, blue (`.n.blue`) when `waiting` (it counts things waiting on someone). A disabled or unknown `selected` selects the first enabled tab |
| `tabStep(tabs, fromId, key)` | `ArrowRight`, `ArrowLeft`, `Home`, `End` | the id that key moves to, wrapping and skipping disabled tabs; null for any other key |
| `bindTabBar(root, { onSelect })` | | a click on an enabled tab, or one of those keys on a tab, calls `onSelect(id)`, then focuses that tab in `root` (after the page's synchronous redraw) |
| `dbTable(cols, rows, { sort })` | `cols`: strings or `{ label }`; `rows`: arrays of cell HTML, or `{ cells, sort }` with a sort key per cell; `sort`: `{ col, dir }` (`dir` 1 or -1) or null | `table.db-t`: sort buttons in the headers (`data-col`, `aria-sort`); rows in sort order, numeric-aware (2 before 10), stable, compared by the cell's text or its sort key; each `tr` with `data-row` (its index in `rows` as passed, not its sorted place) and `tabindex=0`; each cell in `.cell`; one "None" row when `rows` is empty |
| `sortRows(rows, sort)` | | `[[index, row]]` in display order: two keys that are both numbers compare as numbers (-2, 1.25, 1.5, 10), others as text with their digit runs as numbers; a null sort key is empty |
| `nextSort(sort, col)` | | the same column reverses; another starts ascending |
| `bindDbTable(root, { onSort, onOpen })` | | a header click calls `onSort(col)`; a click on a row calls `onOpen(rowIndex)`, the row's `data-row`, unless it lands on a link or control in it (`a, button, input, select, textarea, summary, label`), which is that control's; Enter calls it only when the row itself has focus. The page maps the index to the record and its peek |
| `props(rows)` | `[[key, valueHtml, tip?]]` | `dl.props`; a key with a tip has it as its tooltip |
| `goalSteps({ step, built, met })` | `step` 0–5 (5: all done); `built`, `met`: `{ frac, text, title? }` or null | `ol.steps`: Defining, Planning, Waiting on you, Built, Met, each word following its state (ahead / now / done: Defining / Defining / Defined, Planning / Planning / Planned, Approval / Waiting on you / Approved, Built / Building / Built, Met / Met? / Met); done steps `done`, the current `now`, Built and Met filled to `frac` and with `text` under them. Used by the dashboard's Overview, Goals and goal peek |
| `heartbeat(days)` | `[{ day: 'YYYY-MM-DD', items: [string], failed }]`, oldest first, today last, one entry for every day (`/api/data`'s `upkeep_days`). A day with no upkeep is `{ day, items: [], failed: false }`: present, never missing, `items` always an array | `.heartbeat`, a cell a day: `l1`–`l4` by its number of items, `bad` when `failed`, empty on a quiet day; its title lists the day's items; under it the first day's date, written from its string ("Nov 2", whatever the viewer's locale), and "today" |
| `PULSE_STATES` | | `{ state: { label, tone, rank } }` for every pulse state the hub knows (`building`, `moving`, `blocked`, `waiting`, `stalled`, `idle`, `parked`, `gone`, `starting`, `unknown`) |
| `statusPill(state)` | a pulse state | `<span class="pill <tone>">label</span>`, the hub's words and tone; an unknown state as `unknown` (Running) |
| `fleetSwitch({ scope, mode, counts, confirming, busy, error })` | `scope`: `project` (labelled Fleet), `row` (a hub card, no label) or `machine` (Every fleet); `mode`: `run`, `drain`, `park` or `mixed`; `counts: { running, draining, parked }` | `.fleet-switch`: a dot in the mode's colour and the label, then a `.seg` of Run, Drain, Park (`data-fleet`, `aria-pressed`; with `mixed` none pressed and the label "Mixed: n running, d draining, m parked"); `confirming` swaps Park for its confirm ("Confirm park"; on the machine "Park N projects?", N the projects it would park, running plus draining); `busy` (a line) disables the buttons and shows it; `error` shows in `.err`. The Settings link beside it in the sidebar is the settings area's, not the switch's |
| `bindFleetSwitch(root, { onPress, onConfirm, onCancel })` | | Run, Drain, or Park while not confirming: `onPress(mode)`; the confirm: `onConfirm('park')`; Escape in a confirming switch: `onCancel()` |
| `threadsTabs.register({ id, label, count, render, disabled })` | | a Threads tab; `count()` its number, `render(el)` draws its pane |
| `threadsTabs.list()` | | `[{ id, label, count, disabled }]` in order |
| `threadsTabs.render(id, el)` | | draws that tab into `el`; a render that throws shows its error in `el`, and the other tabs keep working |

**Where UI state lives.** The page owns each fleet switch's `confirming`, `busy` and `error`, keyed per switch (the project, a hub row's root, or the machine), and each table's sort, and passes them back to the builder on every redraw, so the dashboard's 10-second redraw never drops a confirm, a busy line or an error. On `onPress('park')` the page sets `confirming`; on `onConfirm` or another mode it clears it and calls its `post(mode)` (a promise: the dashboard's calls `press('fleet', …)`, the hub's `setFleet(roots, mode)`, one root for a card, every root for the machine), setting `busy` while it runs and `error` from the result.

**The Threads panel's tabs.** The cleanup registers Inbox (first, the red count of open questions; `kit-100`) and Threads (`kit-89`), then two disabled slots for the follow-on goal: Supervisor (the supervisor's terminal) and Shell (a plain shell at the repo root).

## 6. The URL

A hash is one of two kinds of head.

**A page head:** `#<page>[?<state>]`. The state keys, each that control's default when missing:

| Key | Page | Values |
|---|---|---|
| `th` | every page | `inbox`, `open`, `resolved`: the Threads panel is open, on its Inbox tab or on Threads with that list |
| `t` | every page | the open thread's id |
| `goal` | board, progress, library | a goal id |
| `feat`, `repo`, `att` | board | a feature, a repo, `1` (Needs attention) |
| `narrow`, `show` | progress | the view within the goal; `complete` or `all` (Active is the default) |
| `kind` | library, loop | Library's Kind filter; Self Improvement's Kind filter on Orient |
| `gt` | goals | `met`, `letgo` |
| `st` | sensors | `fleet` |
| `lt`, `orient` | loop | `orient`, `decide`, `act`; `1` (Needs orienting) |

Only page heads carry state. `STATE_KEYS` in the block lists them; `parseHead` keeps only the keys of the head's page.

**A link head:** today's grammar, unchanged: `preview/…`, `artifact/…`, `review/…`, `review-preview…`, `talk/<id>` (an owner thread's card), `thread/<mid>` (a message's thread, in the peek), `file?path=…&title=…&ref=…&repo=…`, and every other peek kind as `<kind>/<id>`. Page ids never contain `/` or `?`, and no page id is a link kind (the test checks), so the two never collide.

**The router's table** is the page's own, outside the block, so the tickets that change it (`kit-93`, `kit-100`) never touch the block. In `index.html` it is `SHELL_ROUTES`, in the `shell-routes` marker block:

```js
{ pages: [ids],
  links: { kind: home page },          // what a link opens over on a cold load
  files: [[RegExp, home page]],        // file? by its path; else library
  redirects: { head: head } }          // followed once, by replaceState
```

What a link opens over on a cold load: ticket, feature, story, release, wave, milestone, planner and thread over `board`; goal over `goals`; q over `overview` (an open question's link opens the panel's Inbox tab over the page it was clicked on, from `kit-100`; until then the Inbox page); a file over `governance` for governance, process and strategy paths, else `library`; act, decision, lesson, problem, signal, learning and observation over `loop`; sensor over `sensors`; retro over `retros`; artifact, preview, review and review-preview over `library`; talk over its thread's subject page, which the router knows and the table can't, so the table's `overview` is the fallback for a thread with no subject; anything else over `overview`. Redirects: `#monitoring` → `#sensors`, `#health` → `#sensors?st=fleet`, and from `kit-100` `#inbox` → `#overview?th=inbox`.

| Function | Gives |
|---|---|
| `parseHead(hash, routes)` | a page head: `{ page, state }` (an unknown or empty head: `overview`; a followed redirect adds `redirected: true`); a link head: `{ link, kind, home }`, `link` the head without `#` |
| `headFor(parsed)` | the hash again: state keys in `STATE_KEYS` order; a link verbatim. `headFor(parseHead(h))` is `h` for every canonical head |

## 7. History

Moving between pages, opening a peek, and switching a page's tab or filter each assign `location.hash`, so each is a history entry and Back walks them. Opening or closing Threads, picking Open or Resolved, and opening a thread each push a page head with the new `th` and `t`.

Every entry carries `history.state = { page, depth, openedHere }`:
- `page` is the page head under the peek (the entry's own head when no peek is open). While a peek stays open, a change to `th` or `t` updates `page` with `replaceState`.
- An entry made in the visit (a hash assignment, or a `<a href="#ticket/…">` link) has no state when it arrives; the router stamps it at once with `replaceState`.

| Function | Gives |
|---|---|
| `stampFor(entry, here, cold, routes)` | `entry = { hash, state }`, `here` the stamp of what was on screen (or null), `cold` true on the visit's first route, `routes` the router's table. An entry with a state keeps it. A page head: `{ page: its head, depth: 0, openedHere: !cold }`. A link on a cold load (or with nothing on screen): `{ page: its kind's home page (a file by its path), depth: 1, openedHere: false }`. A link from a page: `{ page: here.page, depth: 1, openedHere: true }`; from a peek: `{ page: here.page, depth: here.depth + 1, openedHere: here.openedHere }`. So `openedHere` means every entry down to the page was pushed in this visit, and a peek opened inside a cold-loaded peek closes in place |
| `withPage(state, page)` | the same stamp with its page head changed: the router's `replaceState` when `th` or `t` change under an open peek |
| `closeTarget(state)` | closing a peek: `{ go: -depth }` when `openedHere` (the visit pushed the entries below it), else `{ replace: page }`. Never Overview, unless that is the page |

## 8. Remembered filters

`localStorage` keeps the last filters (`devteam.board.filters`, one flat object `{ goal, feat, repo, att, kind }`) and the Threads panel's open state (`devteam.threads.*`). They apply only to a fresh entry that carries none of the page's own keys, and the router writes them into that entry's hash at once. Fresh means a cold load, a nav click or a link; an entry made by a Threads or filter change on the page is not fresh. An entry reached by Back or Forward shows exactly its own keys. Each page remembers only its own filters (`REMEMBERED`): Board `goal`, `feat`, `repo`, `att`; Progress `goal`; Library `goal`, `kind`; Self Improvement's `kind` and `orient` are never remembered. The goal is shared by the three.

| Function | Gives |
|---|---|
| `rememberedFilters(page, keys, fresh, stored)` | on a `fresh` entry whose head carries none of the page's remembered keys (`keys`: the keys it carries), the stored values of that page's own keys; else null. `stored` defaults to `devteam.board.filters`; a store that throws gives null |
| `saveFilters(page, state)` | writes the page's own remembered keys from its state and clears those its state lacks, leaving other pages' keys: a filter the owner cleared stays cleared, and clearing the goal on one page clears it for all three. The router calls it on every entry of a page that remembers. A throwing store does nothing |

## 9. The measure

`test/lib/measure.mjs` runs one function in a page in headless Chrome and returns its failures, each named by its check:

| Check | Fails when |
|---|---|
| `prose` | a running-text element (`p`, `.ctx`, `.goal-next`, `.doc li`, and what the page adds) is wider than `--measure` |
| `overflow` | an element sticks out of its parent by more than 1px, outside containers that scroll or clip, and absolute or fixed overlays |
| `uneven` | two `.card`s with the same parent and top differ in height by more than 1px |
| `head-end` | a `.card-head`'s last item ends short of the head's right edge |
| `page-top` | the page's first content's visual top is not `--page-top` below the bar |
| `head-h` | a `.card-head`, small cards included, is not `--head-h` tall |
| `header-pad` | the bar's title starts, or its Inbox button ends, other than `--header-pad` from the bar's ends |
| `tab-motion` | a tab or its underline has a transition |

`measureAt(page, url, opts)` loads a URL at 1440×900, 720×800 and 390×844 and measures each. The options name the page's own selectors: `view` (default `.page`), `bar` (`.pagebar`), `title` (`.pagebar h1`), `inbox` (`.pagebar .tt`), `prose` and `ignore` (each added to the defaults, never replacing them; `ignore` is left out of every check: overlays, code, hidden elements, and `.no-shell` regions, which aren't on the shell yet).

The fixture `test/fixtures/dashboard-shell.html` is a page built only from the two blocks; every check passes on it at all three sizes, and each fails on a broken copy (`test/dashboard-shell.test.mjs`). The page lists are `test/dashboard-measure.test.mjs` (added to only by the `index.html` tickets) and `test/hub-measure.test.mjs` (only by the hub's): each page ticket adds its pages, peeks and threads.

## History

- **@1** (`kit-83`): the two blocks, the router's table (`SHELL_ROUTES`), the measure check and its fixture. The block took the name `goalSteps` for the shared step bar, so the dashboard's own step bar, `goalSteps(g, s, R)`, became `goalStepper(g, s, R)`, with the same output; the goal-page ticket (`kit-90`) moves its callers to the block's `goalSteps`. The hub's `STATES` became the block's `PULSE_STATES`.
