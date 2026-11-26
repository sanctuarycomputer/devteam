# The dashboard shell

Contract `dashboard-shell@2`. Provided by the kit's dashboard (`index.html`) and machine hub (`hub.html`); used by every ticket that rebuilds a dashboard or hub page. It is what the two pages share: one layout CSS block, one JS block, the URL grammar and the measure check.

**Both blocks are complete here.** Every token, style, builder, binder and history rule below lands with this version. Later tickets call them and add their own CSS and JS outside the blocks; no ticket before the copy sweep (`kit-95`) changes either block. A ticket that finds it must change a block takes `hub.html` into its files and an edge with the hub ticket (`kit-94`), re-planned through the supervisor, and bumps this contract. `@2` (kit-267) is such a bump: it changes the URL's functions in the JS block (§6–§8) and adds the hub frame (§10).

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
| `sortRows(rows, sort)` | | `[[index, row]]` in display order: a column whose keys are all numbers (or empty) sorts as numbers (-2, 1.25, 1.5, 10), any other as text with its digit runs as numbers (kit-2 before kit-10), so the order never depends on the input's; a null sort key is empty, and first |
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
| `i` | every page | a card in the panel's Inbox tab: an open question's id (`q-…`, review-page questions included) or a lesson card's (`k-…`); kept only with `th=inbox` |
| `u` | every page | a turn's id (`u-…`) in the thread `t` names |
| `p` | every page | the open peek or viewer: its head without `#` (below) |
| `goal` | board, progress, library | a goal id |
| `feat`, `repo`, `att` | board | a feature, a repo, `1` (Needs attention) |
| `narrow`, `show` | progress | the view within the goal; `complete` or `all` (Active is the default) |
| `kind` | library, loop | Library's Kind filter; Self Improvement's Kind filter on Orient |
| `gt` | goals | `met`, `letgo` |
| `st` | sensors | `fleet` |
| `lt`, `orient` | loop | `orient`, `decide`, `act`; `1` (Needs orienting) |

Only page heads carry state. `STATE_KEYS` in the block lists them, a page's own keys first and then `th`, `t`, `i`, `u`, `p` (`STATE_KEYS['*']`), which is the order `headFor` writes them in, so `p` is always last. `parseHead` keeps only the keys of the head's page. **An empty value is a value:** `goal=` is kept as present with the value `''`, and `headFor` writes it back as `goal=`; the router reads `''` as the control's default (no filter, the panel closed), so `th=` names the panel closed and stays in the head as written.

**`u`, a turn.** The thread opens scrolled to that turn, and the turn is marked. The router drops `u` by `replaceState` when the owner scrolls that turn out of view or posts a reply in the thread, so a reload shows the thread as it was left. `talk/<t-id>?u=<u-id>` is a turn in a thread's card.

**`i`, an Inbox card.** The panel opens on its Inbox tab scrolled to that card, and the card is marked, as a turn is. `parseHead` drops an `i` without `th=inbox`. When the head is read and the tab has no card for `i` (the question was answered, defaulted or withdrawn since, or the lesson decided), the router replaces `i` with that record's peek, `p=q/<id>` or `p=lesson/<id>`, by `replaceState`, so an old Inbox link opens the record read-only. The router drops `i` by `replaceState` when the owner switches the panel's tab or scrolls the card out of view. `th=inbox` excludes `t` and `u`: the router replaces a head that carries both in place without them, so a reload never reopens a thread that would switch the panel to Threads (kit-100's rule) and lose the card. A thread pinned to a question keeps its link head `talk/<t-id>[?u=]`, which opens at that question's card in the Inbox tab with the thread's card beside it.

**`p`, the open peek or viewer.** Its value is exactly that view's link head without `#` (`ticket/kit-88`, `q/q-…`, `file?path=…&ref=…`, `thread/m-…`, `artifact/…`, `preview/…`), URL-encoded as one parameter value: `#progress?goal=g-1&p=ticket%2Fkit-88`. Its kind is one of `SHELL_ROUTES.peeks`, the router's list (outside the block) of every peek kind the dashboard draws (`TYPE_META`'s) and the two viewers. `parseHead` decodes the head's values once, so `p` is the view's own head; `peekHead(v, routes)`, in the block, reads it and gives its canonical form, or null when it names no view, and `parseHead` keeps the canonical form or drops `p`:

- a kind not in `SHELL_ROUTES.peeks` (`talk/`, `review/`, `review-preview`, anything unknown), or one with nothing after its `/`, names no view: `p` is dropped and the page is returned alone;
- a file is `file?<query>`, its query read and written with `URLSearchParams`, its `path` required;
- **an artifact** is `artifact/<at>/<slug>[?path=<page>]`. `<slug>` is an artifact slug (`LINK_ID`, `[a-z][a-z0-9]*(-[a-z0-9]+)*`), else `p` is dropped. `<at>` is `main` (the landed version), `wt/<worktree>` (a draft; the worktree name by `WT_NAME`, `[A-Za-z0-9][A-Za-z0-9._-]*`) or `tree/<id>` (an earlier version, new), its id exactly 40 or 64 lower-case hex characters; any other `<at>` (`tree/` with any other id, `wt` with a bad name, no `<at>`, anything else) reads as `main`. `path` is the page inside the artifact, read with `URLSearchParams` and kept only if the server can serve it: one or more segments separated by `/`, each of `A-Z a-z 0-9 . _ -` only and none empty or starting with `.` (`artifactPathOk`, `artifact check`'s rule for an artifact's file names, which is what the `/artifact/` route serves). Anything else (`..`, `.x/y.html`, `a//b`, `b c.html`, `a\b`, a literal `%2e%2e/x.html`) is dropped with the version kept, and `index.html`, the default, is left out. Such a path holds no character that needs encoding, so the router loads it as written;
- **a preview** is `preview/<name>[?route=<path>]`, `<name>` one segment. `route` is the dev app's path, query and fragment as its lens reports it, read with `URLSearchParams` and left out when it is `/`. The route is the router's to check, because only it knows the app's origin: it must pass today's `tGoRoute` (a path of the app's own, which the lens checks again), and one that fails is dropped from the head by `replaceState` and not sent;
- every other kind is kept as written.

`headFor` writes a `p` query (`path`, `route`, a file's) with `URLSearchParams` again, so they are always encoded inside `p` (`preview/<name>?route=%2Fsettings%3Ftab%3D2`), a page name or a route holding `&`, `=` or `#` round-trips, and nothing is decoded a third time. A bad version or page leaves the viewer at its default (the landed version, `index.html`), and the router, finding `headFor(parseHead(h))` differs from `h`, replaces the head in place.

`p` names the record, and the kind's own opener decides how it shows. A peek opened inside a peek replaces `p` (Notion's rule); closing it drops `p`. **A question's link** is always `p=q/<id>`, so a link copied before the question is answered still opens it afterwards: an answered, defaulted or withdrawn question is a peek like any other, and `p` stays. An open question is not a peek: it opens where the dashboard opens open questions (the Threads panel's Inbox tab, scrolled to its card, the card marked), and the router treats `p=q/<open id>` as a legacy head, replacing the head in place with the page's head plus `th=inbox&i=<id>`, without `p`, `t` or `u`, so no `p` stays in the head with nothing to close it and `th` alone decides the panel's tab.

**The viewers.** An artifact viewer or a preview opens over the page the head names, with the Threads panel the head names (the viewer narrows for the panel), and closing it follows `closeTarget`, so it returns to that page, as a peek does. The version, the page and the route follow the viewer by `replaceState`: choosing a version in the version pill writes its `<at>`, the lens's `ready` writes the artifact's page and its `route` the preview's; each keeps the rest of the head and posts `hub-route` (§10). On a cold load the viewer opens that version, loads that page (`artSrc` plus `path`, kept to the artifact's own folder as `tArtPath` keeps it), and sends the preview its route by `go`, through `tGoRoute`. A tree id names that version's content, so a version link always opens exactly that version. When this checkout can't serve the named tree (`/api/view?kind=artifact&slug=<slug>&at=tree:<id>` answers 404), the viewer shows the landed version with "Not that version: this is the one on main"; when a named draft's worktree is gone, the landed version with "Not the draft: this is the one on main", the new-tab viewer's words. `/view/artifact/<slug>?at=` (open in a new tab) is the viewer's own page, not a dashboard head, and is unchanged.

**A link head** is `review/<q-id>`, `review-preview…` or `talk/<t-id>[?u=<u-id>]` (an owner thread's card beside its subject), and any head of a kind no table names (`#nothing/x`, over Overview). They are unchanged from `@1`: `parseHead` returns `{ link, kind, home }` and `headFor` writes the link verbatim. Page ids never contain `/` or `?`, and no page id is a link or peek kind (the test checks), so the two never collide.

**A legacy head** is a peek's or a viewer's `@1` link head: `#<kind>/<id>` for every kind in `SHELL_ROUTES.peeks`, `#file?…`, `#artifact/main/<slug>`, `#artifact/wt/<worktree>/<slug>`, `#preview/<name>`. Every one written before (in messages, questions, pushes, an in-page `<a href>`) still opens: `parseHead` returns `{ page: home, state: { p: head }, legacy: true }` (`home` the kind's home page from `links`, a file by its path, the viewers' `library`; `state` without `p` when the head names no view, a bad slug, say), and the router replaces it in place with `headFor` of that, by `replaceState`. A legacy head that arrives with a page under it (a click on `<a href="#ticket/…">` from a page) becomes that page's head plus `p`, so in-page links need no change. Until the router adopts `p` (kit-268; the viewers kit-273) it opens a legacy head exactly as `@1` opened its link head, reading `legacy` as `@1` read `link`.

**The router's table** is the page's own, outside the block, so the tickets that change it never touch the block. In `index.html` it is `SHELL_ROUTES`, in the `shell-routes` marker block:

```js
{ pages: [ids],
  peeks: [kinds],                      // what p may open: TYPE_META's kinds, artifact, preview
  links: { kind: home page },          // what a link or a legacy head opens over on a cold load
  files: [[RegExp, home page]],        // file? by its path; else library
  redirects: { head: head } }          // followed once, by replaceState
```

What a link or a legacy head opens over on a cold load: ticket, feature, story, release, wave, milestone, planner and thread over `board`; goal over `goals`; q over `overview`; a file over `governance` for governance, process and strategy paths, else `library`; act, decision, lesson, problem, signal, learning and observation over `loop`; sensor over `sensors`; retro over `retros`; class over `trust`; recurring and builtin over `goals`; artifact, preview, lib, review and review-preview over `library`; talk over its thread's subject page, which the router knows and the table can't, so the table's `overview` is the fallback for a thread with no subject; anything else over `overview`. Redirects: `#monitoring` → `#sensors`, `#health` → `#sensors?st=fleet`, `#inbox` and `#questions` → `#overview?th=inbox`, and the old Loop tab heads.

| Function | Gives |
|---|---|
| `peekHead(v, routes)` | a `p` value (or a legacy head without `#`) as its canonical view head, or null when it names none (above) |
| `parseHead(hash, routes)` | a page head: `{ page, state }` (an unknown or empty head: `overview`; a followed redirect adds `redirected: true`); a legacy head: `{ page: home, state: { p }, legacy: true }`; a link head: `{ link, kind, home }`, `link` the head without `#` |
| `headFor(parsed)` | the hash again: state keys in `STATE_KEYS` order, `p` last, an empty value as `key=`; a link verbatim; a legacy head as its canonical page head. `headFor(parseHead(h))` is `h` for every canonical head |

## 7. History

Moving between pages, opening a peek, and switching a page's tab or filter each assign `location.hash`, so each is a history entry and Back walks them. Opening or closing Threads, picking Open or Resolved, and opening a thread each push a page head with the new `th` and `t`.

Every entry carries `history.state = { page, depth, openedHere }`:
- `page` is the entry's page head without `p` (the entry's own head when no peek is open). A peek opened over a page, or over a peek (which replaces `p`), is one new entry. While a peek stays open, a change to `th`, `t` or `u` is `replaceState`, updating `page` (`withPage`), and the head keeps its `p`.
- An entry made in the visit (a hash assignment, or an `<a href="#ticket/…">` link) has no state when it arrives; the router stamps it at once with `replaceState`.

| Function | Gives |
|---|---|
| `stampFor(entry, here, cold, routes)` | `entry = { hash, state }`, `here` the stamp of what was on screen (or null), `cold` true on the visit's first route, `routes` the router's table. An entry with a state keeps it. A page head with no `p`: `{ page: its head, depth: 0, openedHere: !cold }`. **A `p` head reads its page from the head itself**, so a pasted link closes onto the page it was copied from: cold (or with nothing on screen) `{ page: its page head, depth: 1, openedHere: false }`; arriving while something is on screen (a permalink clicked in a thread turn or a message), when its page head equals `here.page` the rule below for a link from a page or a peek holds, and when it differs `{ page: its page head, depth: 1, openedHere: false }`, so closing it replaces in place to the page the link names and never goes back past it. A link or legacy head on a cold load (or with nothing on screen): `{ page: its kind's home page (a file by its path), depth: 1, openedHere: false }`; from a page: `{ page: here.page, depth: 1, openedHere: true }`; from a peek: `{ page: here.page, depth: here.depth + 1, openedHere: here.openedHere }`. So `openedHere` means every entry down to the page was pushed in this visit, and a peek opened inside a cold-loaded peek closes in place |
| `withPage(state, page)` | the same stamp with its page head changed: the router's `replaceState` when `th`, `t` or `u` change under an open peek |
| `closeTarget(state)` | closing a peek: `{ go: -depth }` when `openedHere` (the visit pushed the entries below it), else `{ replace: page }`. Never Overview, unless that is the page. Unchanged from `@1` |

## 8. Remembered filters and the Threads panel

**What a head says always wins; the browser fills in only what it leaves unsaid, and a copied link leaves nothing unsaid.** `localStorage` keeps the last filters (`devteam.board.filters`, one flat object `{ goal, feat, repo, att, kind }`) and the Threads panel's open state (`devteam.threads.*`). §8 governs freshness: they apply only to a fresh entry, and the router writes them into that entry's hash at once. Fresh means a cold load, a nav click or an in-page link; an entry made by a Threads or filter change on the page (kit-89's `TH_MADE`) is not, and an entry reached by Back or Forward shows exactly its own keys. Remembered filters fill in only a fresh head that carries none of the page's remembered keys, an empty one included, and no `p`. The remembered Threads open state fills in only a fresh head that carries none of `th`, `t`, `u` and `p`. A peek link, legacy or canonical, therefore opens with exactly the filters and the panel it names, and one with no `th` shows the panel closed; a keyed in-page link that names no Threads key (`#loop?lt=orient`) and a bare `#goals` still restore the panel. Each page remembers only its own filters (`REMEMBERED`): Board `goal`, `feat`, `repo`, `att`; Progress `goal`; Library `goal`, `kind`; Self Improvement's `kind` and `orient` are never remembered. The goal is shared by the three.

**Copy link writes every remembered key of its page and `th`, empty when unset** (the pinned form): `#board?goal=&feat=&repo=&att=&th=&p=ticket%2Fkit-88`. So a copied link never leaves a gap for the opening browser to fill. The router's own heads leave unset keys out, as in `@1`, so an address copied from the address bar that doesn't name the panel (no `th`, `t`, `u` or `p`), or the page's remembered filters (and has no `p`), takes them from the opening browser's memory.

| Function | Gives |
|---|---|
| `rememberedFilters(page, keys, fresh, stored)` | on a `fresh` entry whose head carries none of the page's remembered keys and no `p` (`keys`: the keys it carries, an empty one included), the stored values of that page's own keys; else null. `stored` defaults to `devteam.board.filters`; a store that throws gives null. The Threads panel's rule is the router's, which reads `th`, `t`, `u` and `p` from the head |
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

## 10. The hub frame

The hub (`hub.html`) frames each project's dashboard on that project's own origin, and they talk only by `postMessage`. Two messages carry a location, never an action (the Run, Drain and Park exchange, `hub-fleet`, is untouched), each sent only under these guards.

**Dashboard → parent: `{ devteam: 'hub-route', head }`.** One page function, `postHead()`, sends it after every change to `location.hash`, by assignment or by `replaceState` (a Threads, thread or turn change under an open peek, a canonicalised legacy head, the version, page or route a viewer writes, `tlRoute`); every `replaceState` site that changes the hash calls it. `head` is `location.hash`, or `null` when that is over 2,048 characters, so the hub then shows the bare `#<key>` and a reload never opens a different view than the one the hub's address names. It is sent only when the dashboard is framed directly under the top window by a parent on another origin (`window.parent === window.top`, `window.parent !== window`), never in the artifact viewer (`VIEWER`), and only after a `hub-base` has been accepted; its target origin is that `hub-base` message's origin, so a head (which may carry a file path) never goes to an unknown parent. When the first `hub-base` arrives, the dashboard posts its current head at once.

**Hub → its frame: `{ devteam: 'hub-base', base }`.** Sent to the frame's origin (`urlOf`) on every `load` event of the frame (a listener that stays, not a once-only one: the dashboard reloads its own document from its reload button, and on a box a gateway sign-in inside the frame is a navigation too), on each `select` of that project, and after each `hub-route` it accepts. `base` is the address Copy link copies for that project: on a box whose gateway serves project hosts (`box.json` is `box: 2`) it is the project's own host, `https://<project>.<box>/#`; under `box: 1`, and on a laptop, it is the hub's own address, `origin + pathname + '#' + <project key> + '/'`. The dashboard keeps a `hub-base` only from its parent (`ev.source === window.parent`, an origin other than its own and other than `'null'`), and only one whose `base` is a string of at most 2,048 characters that parses as an `http:` or `https:` URL with no user name or password; anything else (`javascript:`, `data:`, credentials, a non-string, a missing `base`) is ignored and the last good `base` stays. Copy link then copies `base` plus the head it links (without `#`), whatever that head's length. Each links its view's head in §8's pinned form: a page's bar the page as shown, without `p`; a peek's header and the viewer's bar the view on screen, the viewer's at the version, page and route it shows; a card in the Inbox tab the page's pinned head with `th=inbox&i=<id>` and no `p`, `t` or `u`; a card's ⋯ menu the current page's head plus that card's own `p`, never `location.hash`. Without a `base` (not framed, an older hub) it copies the dashboard's own origin and path plus that head.

**The hub accepts `hub-route`** only from a project's frame window (`ev.source`), from that frame's origin (`urlOf`), with a `head` that is either a string starting with `#` of at most 2,048 characters or `null`; anything else (a longer string included: the dashboard sends `null` for one) is ignored, and the hash stays where it was. It keeps each project's last accepted head (or `null`). When that project is the selected tab, it sets its own hash to `#<key>/<head without #>` (the bare `#<key>` for `null`) by `replaceState`; no history entry is made, because the frame's own hash changes already made one. `select` of a project writes the same from that project's kept head, not a bare `#<key>`, so switching tabs and back keeps the address on the view its kept frame still shows.

**Hub heads:** `#<project key>[/<dashboard head>]` (`#<key>/<head>`), `#overview[?ot=<operator thread id>]` (`#overview?ot=<id>`, an operator thread), `#settings` and `#terminal`. The key is written URI-encoded, as `select` writes it (`encodeURIComponent(keyOf(it))`), so a literal `/` never appears in it, and the first literal `/` in the raw hash splits the two parts; the key is decoded only after that split. On load, and on a `hashchange` the hub didn't make itself, `#<key>/<head>` selects the project and points its frame at `urlOf + '#' + head`. When a project's port moves and the hub points its frame at the new address, it points it at that address plus the project's kept head, so the view on screen survives. A bare `#<key>`, which pushes still send, works as it does today. A key that matches no project, while exactly one project has that name as its `name`, selects that one; a project gaining a same-named twin gets a hex-suffixed key, and links to its bare name stop selecting it.

**The fakes.** One for each side, so the dashboard's and the hub's tickets build against them in parallel:

- `test/fixtures/hub-frame-fake.html?src=<url>&key=<key>[&hold=1]` frames `src` as project `key`, sends `hub-base` (the laptop form of `base`) to the frame's origin on every load of the frame and after each `hub-route` it accepts, accepts `hub-route` as above and keeps it in its own hash. `window.__log` lists every message it receives (accepted or not) and every `hub-base` it sends, in order; with `hold=1` the first load's `hub-base` waits for `window.__release()`.
- `test/fixtures/dashboard-frame-fake.html` keeps a `hub-base` as above (`window.__bases`, `window.__seen`, `window.__base()`) and, from the first, posts `hub-route` for each hash it is sent to (`null` over 2,048 characters), posting nothing before it.

`test/dashboard-shell.test.mjs` runs the two together on two loopback origins in headless Chrome.

## History

- **@1** (`kit-83`): the two blocks, the router's table (`SHELL_ROUTES`), the measure check and its fixture. The block took the name `goalSteps` for the shared step bar, so the dashboard's own step bar, `goalSteps(g, s, R)`, became `goalStepper(g, s, R)`, with the same output; the goal-page ticket (`kit-90`) moves its callers to the block's `goalSteps`. The hub's `STATES` became the block's `PULSE_STATES`.
- **@2** (`kit-267`): the open peek or viewer in the page head (`p`, `SHELL_ROUTES.peeks`, `peekHead`; an artifact's version, page and a preview's route), an Inbox card (`i`) and a thread's turn (`u`); legacy heads for every peek and viewer link head, rewritten to the page head plus `p`; `stampFor` reading a `p` head's page from the head; an empty value kept as a value and `rememberedFilters` refusing a head with `p`; §10, the hub frame's `hub-route` and `hub-base` messages, hub heads and the two fakes. The router outside the block reads `legacy` as `@1` read `link`, so the live dashboard opens every head as before until kit-268 adopts `p`.
