# kit-100-inbox-in-panel: spec

The Inbox moves into the side panel as its first tab, and leaves the nav.

- Ticket: `kit-100-inbox-in-panel` (feature `dashboard-cleanup`, story DCL-S4, kind build, size M, risk normal)
- Waits on: `kit-89-threads-sidebar`, and through it `kit-88-side-peek` and `kit-87-pages-and-sidebar`. None has merged when this is written. This spec builds on their approved specs and plans (kit-87 spec/plan, kit-88 spec/plan, kit-89 spec at 15b7415 and plan-7). The names it uses from them are listed in §7. The build re-reads all three as merged and reconciles; a real conflict goes to the supervisor.
- Consumes: `docs/devteam/dashboard/shell.md@1`: `threadsTabs.register`, `tabBar`/`bindTabBar`, the `th` key's `inbox` value, `parseHead`/`headFor`/`withPage`, the redirect table outside the block, the layout tokens, the measure. Provides no contract. Neither shared block (`devteam-layout`, `devteam-shell-js`) changes. `SHELL_ROUTES` sits in the page's own `shell-routes` block, outside both.
- Design: home's `project/designs/a-cleaner-more-consistent-dashboard.md`, these sections:
  - `dashboard-shell@1`: Pages, The URL (`th`, what a link opens over, Redirects), A thread pinned to a question, Threads tabs;
  - Nav, pages and settings;
  - Threads (first bullet);
  - Overview and Goals (the Inbox bullet);
  - Everywhere;
  - The measure test;
  - the owner decision "Inbox as a page, or inside the Threads panel" (`m-20261115-020303454-supervisor`).
- The mock: `project/artifacts/dashboard-cleanup/`. Its `VIEWS.inbox` and `.th-inbox` show the look, and its Notes list the inventory (the Inbox items, kit-100).

## 1. Why

The owner chose, after using the mock, to answer the supervisor in the side panel beside any page, not on a page of its own. Everything they owe the supervisor is then in one place, and a nav slot goes. A narrow panel was their first worry about this. It is met because the question card is already one column about the panel's width, and a review page still opens in the full viewer. kit-89 builds the panel with Threads. This ticket adds the Inbox before Threads, points every road into the Inbox at the panel, and takes the Inbox page and its nav item away.

## 2. What changes (index.html, plus tests)

### 2.1 The Inbox element moves into the panel

- **One element, moved, not redrawn.** Today's `<section id="inbox">` keeps its children and their ids: `#ask-inbox`, `#questions`, and `#answered-wrap` (with `#answered-sum` and `#answered`). It leaves `<main>` and becomes `<div id="th-inbox" class="th-inbox">`, a third child of kit-89's `.threads-body#th-body`, beside `#th-pane` and `#th-card-slot`.
  - No pane draw rewrites it. `render()` keeps filling `#ask-inbox`, `#questions` and `#answered` as today, wherever they are. So the 10-second redraw, its draft keeping and every Inbox handler keep working unchanged.
  - Selectors that tests and code use (`#questions [data-qcard]`, `#ask-inbox`, `#answered-wrap`, `#q-<id>`, `#a-<qid>`) still match.
- **The heading goes.** `<h2>Inbox <span class="sub">…</span></h2>` is removed. The tab's label already says Inbox, the mock draws no heading, and the design drops heading sub-lines (Everywhere: Obvious copy goes). The empty states ("Nothing needs you right now…", "Nothing answered yet.") stay as today. Shortening them to "None" is kit-95's sweep.
- **On the shell.** `#th-inbox` is not `no-shell`, so the block's rules and the measure judge it. kit-87 marked the old section `no-shell` until its page ticket ports it, and this ticket is that port.
- **One column, the panel's width.** Cards in `#th-inbox` take the slot's full width, which is `--threads-w` minus 2 × `--panel-pad`, so 348px above 900px and the window minus 32px below. A card's inner rows wrap rather than overflow: the why chips (`.qcard .why { flex-wrap: wrap }`, as in the mock), the choices, the secrets rows and the row of buttons. No card grid inside it. Spacing between cards is `--gap`.
- **Shown when its tab is.** `#th-inbox` is shown only while the panel is open on the Inbox tab. In that case `#th-pane` is empty and `#th-card-slot` holds no in-panel card. It is `hidden` on the Threads tab, and also whenever the panel is closed. A closed panel is only `visibility: hidden` and moved off-screen, so it would keep client rects, and the layer would draw a pin past the window's right edge (spec-1 S4).

### 2.2 The tab

- **Registered first.** `threadsTabs.register({ id: 'inbox', label: 'Inbox', count, render })` runs before kit-89 registers Threads. `threadsTabs.list()` then returns Inbox, Threads, Supervisor, Shell, in that order.
- **`count()`** is `inboxCount()`, a new function. It counts today's nav number for the Inbox: open questions, not yet answered on this page (`ANSWERED`), plus the lessons sent to the owner (`ownerLesson`). It returns `null` at 0.
  - kit-87 copies the nav's `n-questions` into the button's red count, and `inboxTitle` puts it in the tab title. All three now read `inboxCount()`, so they always agree.
  - The `#n-questions` element goes with the nav item. `count('n-questions', …)` and `inboxTitle`'s write to it are removed.
- **Red.** `tabBar` draws `waiting` counts blue. The Inbox count is not drawn as `waiting`, and a page rule colours it red: `#th-tabs [data-tab="inbox"] .n { color: var(--red) }`. The block doesn't change.
- **`render(el)`** empties `el` (`#th-pane`) and returns. Showing `#th-inbox` belongs to the pane draw (below), so a throw in the tab's render can't hide the Inbox.
- **The pane draw.** kit-89 draws the pane for the selected tab on a change of view and on a refresh. This ticket adds one step to that draw: `#th-inbox.hidden = !open || selected !== 'inbox'`, where `open` is whether the head in force has `th`. The card slot is left empty on the Inbox tab (§2.3).
- **Selecting a tab** goes through kit-89's `thGo` like any other Threads change (a history entry, or `withPage` under a link head):
  - Inbox gives `th=inbox`;
  - Threads gives `th=open`;
  - an in-panel `t` is dropped either way, and a floating `t` is kept.

### 2.3 The URL: `th=inbox`

- **The value.** `th=inbox` means the panel is open on its Inbox tab. kit-89's router accepts `open` and `resolved`, and this ticket adds `inbox` to that check. Its redirect entries no longer take `inbox` first (§2.5).
- **`th=inbox` with a `t`.**
  - A floating `t` (for example a thread on a question card, §2.6) stays, and its card opens beside its subject.
  - An in-panel `t` (no subject, or a subject not drawn) is shown only on Threads. On a route whose head has `th=inbox` and an in-panel `t`, the router rewrites `th` to `open` by stamped `replaceState`, so the thread shows.
  - That rewrite is one of kit-89's decisions that need the threads: it waits for the first `/api/threads` read (`TL.have > 0`). Until then the head is kept as it is, so a cold `#overview?th=inbox&t=<S>` isn't misjudged.
  - A thread whose home is the Inbox (`tlInboxHome`, §2.6) is never in-panel, so `th=inbox` with its `t` stays as it is.
- **The top-right Inbox button** (`.tt`, and kit-88's mirror `#tt-peek`, whose click is `.tt`'s) opens the panel on the Inbox tab: `thGo({ th: 'inbox' })`. kit-89 opened it on Threads. Its counts and hiding while open are kit-89's, unchanged.
- **Remembered.** `devteam.threads.open` stores `th=inbox` as it stores `open` and `resolved` (kit-89 §2.5). It never stores a `t` with `inbox`: an in-panel `t` forces `open`, and a floating `t` isn't stored.
- **Focus.** Opening the panel from the button moves the focus to the selected tab, Inbox (kit-89's rule).

### 2.4 Every road into the Inbox

| Road | Today (kit-87 to kit-89) | From this ticket |
|---|---|---|
| nav item `#inbox` | the Inbox page | gone: the Project group reads Overview, Goals, Progress, Board, Library |
| `SHELL_ROUTES.pages` | holds `inbox` | `inbox` removed: `overview, goals, progress, board, library, trust, …` as merged |
| old `#inbox` (a bookmark, an old message, a cold load) | the page | redirect `inbox → overview?th=inbox`, by `replaceState` |
| old `#questions` | redirect to `#inbox` | redirect `questions → overview?th=inbox` |
| `#<page>?th=inbox` | one redirect per page to `#inbox` | the entries go, so it is that page with the panel on Inbox |
| an open question's `#q/<id>` | entry replaced by `#inbox`, then its card scrolled into view | entry replaced by the page head in force with `th=inbox` (on a cold load, `#overview?th=inbox`), stamped. Once the panel shows, `#q-<id>` is scrolled into view inside `#th-body` (`block: 'center'`). Back returns to the page the link was clicked on |
| an answered, defaulted or withdrawn question's `#q/<id>` | its read-only peek (kit-88) | unchanged |
| in-page `<a href="#inbox">`: the Loop's "waiting for you in the Inbox", the lesson peek's "Keep or retire it in the Inbox", kit-88's defaulted-question link (`data-answered-go`) | the Inbox page | one delegated click handler (no Shift, no modifier) opens the Inbox tab over the page shown, with `thGo({ th: 'inbox' })`. The link's `href` stays `#inbox` as the fallback for a new tab, which the redirect serves. kit-88's `data-answered-go` then opens `#answered-wrap`, scrolls to `#a-<qid>` in the panel and focuses its Overrule, as it did on the page |
| a review closed after a cold load (`leaveReview`) | `#inbox` | `#overview?th=inbox` |
| the hub's Inbox stat (kit-94) | `#overview?th=inbox` → the page | the Inbox tab over Overview |

- **Over a peek.** An Inbox road taken from inside a peek (the lesson peek's link, the defaulted question's link) leaves the peek open. It is a Threads change under a link head, so `withPage` adds `th=inbox` to the page under it. The panel opens beside the peek, which stops at the panel's edge (kit-89).
- **Over the viewer.** Taken while the artifact viewer is up, the road opens the panel beside the viewer (kit-89 §2.7).
- **No redirect hop for in-page links.** A delegated in-page link never assigns `#inbox`. Such a hop would redirect to Overview and lose the page the owner was on.

### 2.5 The router's table

`SHELL_ROUTES` (the `shell-routes` block) changes in place:

- `pages` loses `inbox`;
- `redirects` loses every `<page>?th=inbox → inbox` entry and kit-87's `questions → inbox`;
- `redirects` gains `inbox: 'overview?th=inbox'` and `questions: 'overview?th=inbox'`;
- the `// until kit-100` comments go;
- `links.q` stays `overview`: a cold-loaded question link opens over Overview, as the design says.

kit-87's extra lookup also goes: it followed a page head carrying other keys plus `th=inbox` to the Inbox page (`state.th === 'inbox'` and `redirects[page + '?th=inbox']`). With it gone, `th=inbox` reaches kit-89's Threads code like `open`.

### 2.6 Threads whose home is the Inbox

- **A thread pinned to a question** (an item subject `question:<id>`). Its home is the panel's Inbox tab.
  - `T_HOME.question` and `tlHome` point there.
    - `tlHome` looks for a question's open card in the Inbox tab (`#th-inbox #questions [data-subject="question:<id>"]`), not in `main #inbox`. If none is there, it uses today's fallback (`main [data-subject=…]`).
    - The Answered list's copy (`#answered`, a collapsed `<details>`) is never a home: an answered question's thread follows it to wherever `main` draws it (a Decide row), or loses its subject (spec-1 S1).
    - Other kinds keep looking in `main #<page>`.
  - **Floating.** A question in the Inbox is drawn, so by kit-89's `tlInPanel` rule its thread floats rather than opening in the panel.
  - **The pin** sits on the question's card in the panel while the Inbox tab shows. Today's layer places pins and the floating card in document coordinates (adding `scrollX`/`scrollY`), re-places them only on `resize`, and keeps them under the panel (`.tl-pins` z 10, `.threads` z 22). A subject inside the fixed panel doesn't scroll with the page, so its pin and card are placed differently (spec-1 S2, S3):
    - **Fixed, viewport coordinates.** A pin whose subject is inside `#threads` gets the class `in-threads` and is `position: fixed`, placed from the card's viewport rect without `scrollX`/`scrollY`. The floating card of such a thread gets `in-threads` too, `position: fixed`, placed the same way. A page scroll then doesn't move them.
    - **Only these are lifted.** A page rule gives `.pin.in-threads` and `.tl-card.in-threads` a `z-index` above `.threads`. Every other pin and card keeps its z-index, so where the panel covers the page (900px and below) the page's pins stay under it, as today.
    - **Re-placed** on a `#th-body` scroll (a listener on `#th-body`, `passive`), on the panel's `transitionend` (the slide open ends after the first placement), on a tab change and on `resize`. A pin whose card's rect falls outside `#th-body`'s visible box is hidden, so it never floats over the tab bar or past the panel.
  - **Its floating card** opens beside the card, just outside the panel.
    - Above 900px with the panel open, the card's right edge is 10px left of the panel's left edge, at the card's top, clamped to the window. `tPlace` is called with the subject's rect clipped to the panel's left edge. kit-89 passes the window narrowed by `--threads-w`, and `tPlace` itself is unchanged.
    - At 900px and below the panel covers the page. kit-89 hides every floating card while the panel is open there. A card whose subject is inside `#threads` is the exception: it shows over the panel, placed by `tPlace` in the full window, and as today's bottom sheet below 640px. Between 640px and 900px the 360px card therefore covers part of the question card rather than sitting beside it. That is intended: the panel is the whole window, and no room is left beside it (spec-1 S12).
  - **Hidden subject.** While the Inbox tab isn't shown, the card's subject has no box, so an open card sits in kit-89's corner place (`.tl-card.in-dock`) and no pin is drawn. The row in Threads still lists the thread with its pin number and "Inbox" (`T_WHERE`).
- **Opening it.** A row click, a pin, or a `#talk/<id>` link, cold or clicked, opens the panel's Inbox tab at the card and opens the card beside it. kit-87's `subjectHead(s)` for a subject inside `#th-inbox` gives the page head in force plus `th=inbox` (cold: `#overview?th=inbox`), with `t=<id>`, not a page.
  - So kit-89's floating-row rule ("the subject's page head with `t`, `th` kept above 900px, dropped below") keeps `th=inbox` at every width for these threads. Below 900px the card shows over the panel (above).
  - Once the panel shows, the card scrolls into view in `#th-body` and the thread's card opens.
- **Shift+click in the Inbox tab** starts a thread on what is under the pointer, as on today's Inbox page. Under kit-89 the whole panel is the layer's own and never a thread target. This ticket narrows that to the panel minus `#th-inbox`:
  - `tlOwn(el)` is true inside `#tl` or `#threads`, except inside `#th-inbox`;
  - `tlHitAt` gives no subject over `#threads` except inside `#th-inbox`, where it finds the subject as on a page.
  - The rest of the panel (tab bar, head buttons, Threads pane, in-panel card) stays the layer's own.
- **A thread pinned to a spot on the old Inbox page** (a `page` subject whose `view` is `#inbox` or `#questions`, or any view the redirects send to `th=inbox`). It stays listed in Threads, labelled "Inbox" (`T_SECTIONS.inbox`, kept for these old subjects).
  - Opening it, by row or link, opens the Inbox tab over the page in force and opens its card with no pin. The spot was on a page that no longer exists.
  - The card sits in the corner place beside the panel above 900px, and over the panel at 900px and below, as for a question thread.
  - **This ticket owns the rule.** `tlInboxHome(t)` is true for a thread whose subject is a question drawn in `#th-inbox #questions`, or a page subject whose view `parseHead` sends to `state.th === 'inbox'`. kit-89's `tlInPanel(t)` returns `false` for such a thread, before its other cases. kit-89 judges a page subject by whether its section exists, and no `#inbox` element exists after this ticket (spec-1 S5).
    - The `th` rewrite (§2.3), `subjectHead`, the store (§2.3) and kit-89's floating-row rule all read `tlInboxHome`.
    - A page subject that is Inbox-home has no rect, so it draws no pin, and its card takes the corner place.

### 2.7 Keeping what the owner types

kit-89 makes the panel the layer's own for three things that are wrong for the Inbox, because `render()` does rebuild the Inbox. Each exception narrows from `#threads` to the panel minus `#th-inbox`:

- `holding()`. A focused field in `#th-inbox` holds the 10-second redraw, as a field on today's Inbox page does. Fields in the rest of the panel and in `#tl` hold nothing, as kit-89 has it.
- `render()`'s draft keeping (`textarea[data-q]`, `input[data-reason]`, `input[data-overrule]`, `input[data-rulebox]`, `input[data-auto]`) reads fields in `#th-inbox` as it read the page's. It skips the in-panel card (`#th-card-slot`) and `#tl`.
  - The same question asked in a thread is drawn twice, in the Inbox tab and in the thread's in-panel card. The two copies never overwrite each other's half-typed words: only one shows at a time, and only the Inbox copy is kept by `render()`. The card's copy is the layer's (kit-89).
- A press inside `#th-inbox` is a page press (`PRESSED`), not the layer's (`TL.pressed`).
- **Escape** (kit-89 §2.9: focus in `#threads` closes the in-panel thread or the panel). With the focus in a text field inside `#th-inbox` (`textarea`, `input[type=text]`), Escape is left to the field and closes nothing, so a half-typed answer isn't hidden by a stray key (spec-1 S10). With the focus anywhere else in `#th-inbox` (a button, a choice), Escape closes the panel, as it does elsewhere in the panel.

### 2.8 Reviews and the full viewer

A review card's Open the review opens `#review/<qid>`, as today. The review shows in `#review-view`, over the page and the panel, at its full size, never squeezed into the panel. The page head in force under it keeps `th=inbox`. Leaving the review (its close, or `leaveReview`) returns to the page with the panel on the Inbox tab.

### 2.9 What doesn't change

- The cards, their contents, their handlers, the `/api/*` calls and answers, `questionCard`, `reviewCard`, the lesson cards, the secrets forms, `answeredCard`, `askHtml`/`askDraw` (targets `ask-inbox`, `ask-threads`, `tl-c-ask`, as kit-89 left them).
- kit-89's Threads tab, its list, the counts on the button and the panel's frame.
- `hub.html`, the shared blocks, `threads-core`.

## 3. Acceptance checks (the done-whens)

The new browser test is `test/dashboard-inbox-panel.test.mjs` (headless Chrome, skipped where Chrome can't be driven, as the kit's other Chrome tests are).

**Its fixture** is a project built with the kit's CLI as the supervisor would build it. It holds:

- six open questions:
  - `q1`, a choice question with a standing-rule box (`Q`'s subject);
  - `q2`, a choice question (the Shift+click target, then the typing check and a note Send);
  - `q3`, an owner-action (Done);
  - `q4`, `q5` and `q6`, one secret each (Post, Reply, Can't right now);
- one review-page question `r` (`ask --kind review`, with a page and data checked in);
- two lessons for the owner, `L1` and `L2`;
- one answered question, one defaulted question and one withdrawn question;
- a goal;
- a thread `Q` pinned to the first open question (subject `question:<id>`);
- a thread `P` with a page subject on `#inbox` (an old Inbox spot, written to the thread store as an old dashboard wrote it);
- a subjectless thread `S`;
- the terminal's waiting prompt, faked as kit-89's tests fake it.

The Inbox's count with this fixture is 6 + 1 + 2 = 9 (`d.questions` includes the review question). AC1 to AC4 and AC7's screenshots run first, on the fixture as built. AC5, which answers questions and changes the count, runs last. The fixture builder is `inboxFixture` in `test/lib/kit.mjs`, so the measure test can seed a project with it too.

1. **The tab and the button** (done-when 1).
   - `threadsTabs.list()` ids are `['inbox', 'threads', 'supervisor', 'shell']`. `#th-tabs`'s first tab reads "Inbox" with the count 9, and that count's colour is `--red`.
   - Clicking `.pagebar .tt` makes the hash `#overview?th=inbox`, opens the panel and selects the Inbox tab. `#th-inbox` is shown inside `#threads`. It holds `#ask-inbox` (the terminal's card), every open question's card (`#questions [data-qcard]`), the review card, the lesson card, the secrets form and `#answered-wrap` (collapsed, "Answered (n)").
   - `.tt`'s red count equals the tab's.
   - Choosing Threads makes the hash `…?th=open` and hides `#th-inbox`. Choosing Inbox brings it back, with `th=inbox`.
   - A reload of `#goals?th=inbox` shows Goals with the panel on Inbox.
   - `#th-inbox` is not inside a `.no-shell` element.
   - Closing the panel by `#th-close` hides `#th-inbox`. With the panel closed on every page, no `[data-tl-pin="<Q>"]` is drawn and `document.documentElement.scrollWidth === innerWidth`.
2. **The nav and the roads** (done-when 2).
   - The nav has no `a[href="#inbox"]`, and its Project group reads Overview, Goals, Progress, Board, Library.
   - `SHELL_ROUTES.pages` has no `inbox`.
   - On Board, a click on an open question's `#q/<id>` link gives `#board?th=inbox` with Board shown, the panel on Inbox and `#q-<id>` inside `#th-body`'s visible box. Back returns to `#board` with the panel closed.
   - A cold load of `#q/<open id>` (a new tab) gives `#overview?th=inbox` with the card in view.
   - Each of the answered, defaulted and withdrawn questions' `#q/<id>` opens its read-only peek (`#drawer` shown, no Answer button inside it).
   - Old `#inbox`, loaded from Overview by a hash change, becomes `#overview?th=inbox` by `replaceState`: `history.length` grows by one, and Back lands on the page before. Old `#questions` does the same.
   - Both are entries in `SHELL_ROUTES.redirects` (the test reads them). The redirects sit inside the `shell-routes` block markers and outside `devteam-shell-js`; the test reads the block boundaries from the file.
3. **`th=inbox` and the old Inbox spot** (done-when 3).
   - `#board?goal=<g>&th=inbox` opens Board, keeps `goal`, and opens the panel on Inbox. `SHELL_ROUTES.redirects` has no key ending `?th=inbox`.
   - Thread `P` is listed under Threads, with "Inbox" as its subject line. Clicking its row opens the Inbox tab (`th=inbox&t=<P>`) with `P`'s card open and no `[data-tl-pin="<P>"]` drawn.
4. **A thread on a question** (done-when 4). `T_HOME.question` and `tlHome` are checked in `vm` and in the page: `tlHome({ kind: 'item', ref: 'question:<id>' })` is inside `#th-inbox`.
   - At 1440x900, on Overview with the panel on Inbox, `Q`'s pin is drawn and its centre lies inside `q1`'s card. The element at the pin's centre is the pin, so it is above the panel.
   - Still inside `q1`'s card (±1px) after `window.scrollTo(0, 400)` on a page tall enough to scroll, and after `#th-body` is scrolled by 100px. Hidden once `#th-body` scrolls `q1`'s card out of its visible box.
   - Clicking the pin opens `Q`'s card. Its right edge is at most the panel's left edge, and its top is within the window.
   - From `#goals?th=open`, clicking `Q`'s row gives `#goals?th=inbox&t=<Q>`: the panel is on Inbox, the card is in view and the floating card is open beside it.
   - A cold load of `#talk/<Q>` opens `#overview?th=inbox&t=<Q>` with the card open beside the question's card.
   - At 720x800, `Q`'s row keeps the panel open on Inbox and the floating card shows (it is visible, and the element at its centre is in `#tl-card`).
   - Shift+click on the second open question's card in the Inbox tab starts a draft card beside it. Sending words makes a thread listed with subject `question:<id>`.
   - Shift held over the Inbox tab's tab bar shows no pin.
   - At 720x800 on Goals with `G`, a thread on the goal's card, and the panel open on Inbox: the element at `G`'s pin's former centre is inside `#threads`, so the page's pins stay under the panel.
   - Once `q1` is answered (by the API, then one redraw), no pin is drawn inside `#th-inbox`, and `tlInboxHome(Q)` is false.
5. **Every control works from the panel** (done-when 5), each on a fresh question of the fixture where it posts:
   - pick a choice and Answer (its `POST /api/answer` lands, and the card leaves);
   - type a note and Send;
   - Done on the owner-action `q3`;
   - Post on `q4`'s secret, Reply on `q5`'s and Can't right now on `q6`'s;
   - Overrule on the defaulted question's Answered card (`#answered-wrap` opened);
   - Keep it on `L1`, then Retire it on `L2` (each `POST /api/knowledge`);
   - the standing-rule box, checked, rides on the answer;
   - the lesson's note box rides on Keep it;
   - the terminal card's numbered option sends.
   - Words typed into a note box survive a 10-second redraw and a threads poll, with the focus kept and the caret position kept. The test waits for a redraw to arrive and be held (`HELD` set), not for `render()`, which a working hold never runs. After blur, the held draw lands, and the words are kept in the drafts.
   - Escape with the focus in that note box leaves the panel open.
   - Open the review shows `#review-view` wider than the panel, with the hash `#review/<qid>`. Closing it returns to the page with the panel on Inbox.
6. **The measure** (done-when 6). `test/dashboard-measure.test.mjs` gets these entries:
   - Settings with the panel on Inbox (`#settings?th=inbox`, the fixture's cards drawn and `#answered-wrap` open), at 1440x900, 720x800 and 390x844, on every check shell.md §9 names. Settings is on the shell from kit-87, so `page-top` is judged. Overview isn't ported until kit-90, which waits on this ticket (spec-1 S6). If, at merge, another page under the panel suits better and is on the shell, the build may use it and says so in `verification.md`.
     - `opts.inbox` points at nothing, as kit-89's entries do, since the button hides while the panel is open.
     - So the overflow check judges the Inbox's own boxes (`measure.mjs` skips anything inside a scrolling container), the entry's `ready` sets `#th-body`'s `overflow` to `visible` and fixes its width to its own content width with the scrollbar. The Inbox is then laid out at its real width, and nothing else changes. `measure.mjs` doesn't change.
     - The checks then judge the Inbox: `prose` (running text within `--measure`), `overflow` (nothing sticking out of its parent), `head-h` and `head-end` (card heads `--head-h` tall, their last item at the right edge), and `tab-motion` (the panel's tab bar). They judge the page under it, Settings, for `page-top` and `header-pad`.
     - One choice's detail in the measure fixture is a 120-character unbroken link, so a long string at 390 wide is judged.
     - `uneven` excludes cards inside `.threads` by design, and the Inbox has no cards side by side.
   - kit-87's interim `#inbox` page entry is removed.
7. **Nothing lost** (done-when 7). The final review checks each item of the mock's Inbox inventory one by one, against the panel:
   - **the question card:**
     - its head, with the ⋯ menu: ID, asked, kind, order and score;
     - the why-ranked chips and "Why you";
     - choices with Recommended, the sure-percentage and each choice's effect for users;
     - the note box and the standing-rule box;
     - "Next time, for decisions like this";
     - the default and deadline line;
     - Answer, Send or Post, Reply, Can't right now;
     - "changed since asked" on a link;
     - Shift+Enter answers;
     - a refused answer's reason, kept until dismissed (kit-82);
     - owner-action cards with a button per named record (kit-236);
   - lesson cards (Keep it, Retire it, the note box, the technical wording);
   - review-page cards (Open the review, Send it back with a reason, the changed-since-asked error);
   - the secrets form (Post, Reply, Can't right now, Don't use this sensor);
   - the terminal's prompt card with a button per numbered option, and the usage-limit line;
   - the collapsed Answered list, with each answered card and Overrule on a defaulted one.

   `verification.md` carries the checklist, each item with where the test or a screenshot shows it.
8. **Existing tests.** `test/dashboard.test.mjs` and the other touched test files pass, with every `#inbox` page read and navigation moved to the panel and every assertion about the cards unchanged. kit-89's `test/dashboard-threads-sidebar.test.mjs`, kit-87's `test/dashboard-pages.test.mjs` and `test/dashboard-shell.test.mjs`, and kit-88's `test/dashboard-peek.test.mjs` change only where they assert the interim this ticket ends, as ruled into touches (`m-20261115-225154606-supervisor`).
9. **The `/view/` tab** (ruling `m-20261115-230458641-supervisor`). At `/view/artifact/<slug>`, clicking `#tt-peek` opens `#threads` on Threads. `threadsTabs.list()` ids are the same four. The Inbox tab's count equals hello's `inbox`. Choosing it shows one link, "Answer questions on the dashboard.", whose `href` is `/#overview?th=inbox`. `/api/data` is never asked.

## 4. Edge cases

- **No questions at all.** The tab shows no count, the button shows no red count, and `#questions` shows today's empty line. The panel still opens on Inbox.
- **A question answered in another tab** while this one shows it. The 10-second redraw removes the card from `#questions`, as today. Its thread is no longer Inbox-home: its subject is found where `main` draws the question (a Decide row, so the thread floats there), or nowhere, which makes it kit-89's " · subject gone", in-panel. No pin is left in the panel (§2.6, AC4).
- **The panel open on Inbox, then a nav click.** kit-89's remembered store carries `th=inbox` to the next page.
- **A cold load of `#overview?th=inbox` before `/api/data` answers.** The panel opens on Inbox, and `#th-inbox` shows today's loading state (`main.waiting` doesn't cover the panel). The cards come with the first `render()`. Neither `#q/<id>` nor `#talk/<Q>` scrolls until the card exists: the scroll waits for the first render, at most one redraw.
- **A `#q/<id>` link for an open question not yet loaded** (cold). It waits for the first `/api/data`, as today, to know the status: open opens the Inbox tab, anything else opens the peek.
- **`th=inbox&t=<in-panel id>`.** Rewritten to `th=open` (§2.3).
- **Shift+click on the Inbox tab's empty space.** No subject, so it gives a page subject only if the layer gives one for empty page space today. The panel has no page view, so the layer gives none here.
- **Below 900px** the panel is the full width, the cards are the window's width minus 32px, and their rows wrap. Below 640px a question thread's card is the bottom sheet over the panel.
- **The `/view/` tab** (kit-89 §2.8) has no `render()` and no Inbox data. Its panel registers the same tabs, so the Inbox tab is there with no cards. Its pane shows one line, "Answer questions on the dashboard.", linking to `/#overview?th=inbox`. Its count is hello's `inbox`, which `thDraw()` already reads. The `/view/` button (`#tt-peek` there) opens the panel on Threads, as kit-89 has it, since that tab is about the artifact's threads (ruling `m-20261115-230458641-supervisor`). AC9 tests both.
- **Reduced motion.** Nothing here animates beyond kit-89's panel.

## 5. Out of scope

- The Next chip on the next best step (`kit-90`).
- Any change to a card's content or look beyond fitting the column (wrapping rows).
- The Supervisor and Shell tabs' contents.
- `hub.html` (its Inbox stat's link is `kit-94`'s).
- Shortening the empty states (`kit-95`).
- Any change to `measure.mjs`, the shared blocks, `threads-core`, `/api/*` or `devteam.mjs`.

## 6. Questions for the supervisor

1. **Files outside touches** (ruled: all nine added, `m-20261115-225154606-supervisor`; list in `touches-request.md`).
   - Seven test files assert the interim this ticket ends: `test/dashboard-shell.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard-peek.test.mjs`, `test/pane-question.answer.test.mjs`, `test/next-step.strategy.test.mjs` and `test/browser/dev-links.mjs`.
   - Two more, `test/dashboard-answers.test.mjs` and `test/dashboard-owner-action.test.mjs`, need navigation-only edits, and only if the `#questions` redirect isn't enough.
   - Recommendation: add all.
2. **The `/view/` tab's Inbox tab** (§4), asked in `m-20261115-230453850-kit-100-inbox-in-panel`, ruled `m-20261115-230458641-supervisor`: as recommended. The tab shows there with hello's count and one line linking to the dashboard's Inbox, and the `/view/` button opens the panel on Threads.

## 7. Names this builds on (from kit-87, kit-88, kit-89's approved records)

- **kit-87:**
  - `SHELL_ROUTES` in `shell-routes`, with `questions → inbox` and the `<page>?th=inbox` entries;
  - the router's `th=inbox` lookup;
  - `showPage`, `sectionPage` and `subjectHead`;
  - `goHead(…, { replace })`;
  - `openQuestion`'s `hideDrawer()` + replace;
  - `#inbox-btn` (`.pagebar .tt`), whose red count `#inbox-btn-n` is copied from `n-questions`;
  - the `#inbox` measure entry with `view: '#no-such-view'`;
  - the old sections marked `no-shell`.
- **kit-88:**
  - the mirror `#tt-peek`;
  - `data-answered-go` and the `a-<qid>` ids;
  - `answeredCard(q, { inPeek })`;
  - `hideDrawer`;
  - `overlay-open`.
- **kit-89:**
  - the panel's markup: `#threads`, `#th-tabs`, `#th-body`, `#th-pane`, `#th-card-slot`, `#th-close`;
  - `thGo` and `TH_MADE`;
  - the `th`/`t` checks;
  - `devteam.threads.open`;
  - `tlInPanel`;
  - `tlOwn` and `tlHitAt` over `#threads`;
  - the `holding()` and draft-keeping exceptions for `#threads`;
  - `.tl-card.in-dock`;
  - hiding floating cards at 900px and below;
  - `tPlace` called with the window narrowed by `--threads-w`;
  - `askDraw` targets;
  - `thDraw()` in `/view/`.

## 8. Rulings

- `m-20261115-230458641-supervisor` (on `m-20261115-230453850`): in `/view/` keep the Inbox tab with hello's count and "Answer questions on the dashboard." linking to `/#overview?th=inbox`; the button opens the panel on Threads. In the spec, and tested (AC9).
- `m-20261115-225154606-supervisor` (on `m-20261115-225124449`): all nine files in `touches-request.md` are in touches (the seven, plus `test/dashboard-answers.test.mjs` and `test/dashboard-owner-action.test.mjs` for navigation only). Change only the interim-Inbox assertions in them.
