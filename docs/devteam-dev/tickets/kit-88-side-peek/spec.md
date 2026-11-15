# kit-88-side-peek: spec

The side peek slides in, opens with properties, says how it changes, holds no permanent action, and every row and card opens its record.

- Ticket: `kit-88-side-peek` (feature `dashboard-cleanup`, story DCL-S3, risk normal, size M)
- Waits on: `kit-87-pages-and-sidebar` (pages, the side nav, the page bar and its top-right button; it puts `shell` on `<body>` and `no-shell` on the old drawer and scrim)
- Consumes: `docs/devteam/dashboard/shell.md@1` (the peek frame `.scrim`/`.drawer`/`.drawer-head`/`.drawer-body`, `peek-open` on the `.shell` element, `props()`, `bindDbTable`, the tokens, the measure)
- Design: home's `project/designs/a-cleaner-more-consistent-dashboard.md`, "The side peek", "Everywhere", "The measure test"; the owner's mock `project/artifacts/dashboard-cleanup/` (the reference, per ruling `m-20261115-195003493-supervisor`)

## 1. Why

Today's peek pops in with no motion, opens on whatever its opener drew first, carries writes (Retire it on a lesson, Overrule on a defaulted question), and half the dashboard's cards open nothing or have a separate Open link. The owner settled the replacement in the mock: one frame that slides, properties first with the ID on top and a tooltip on every key, a "How it changes" row that says how the owner changes the thing (R2), nothing in a peek that does something permanent, and every row and card opening its record. Nothing today's peeks show may be lost (owner, thread `t-20261114-232755035-owner`: polish, don't drop).

## 2. What changes (index.html only, plus tests)

### 2.1 The frame

- **Adopt the block's peek frame.** Take `no-shell` off `#scrim` and `#drawer` (kit-87 puts it there), and remove or narrow today's own `.scrim`, `.drawer`, `.drawer-bar`, `.drawer dl/dt/dd/h3` rules so one rule styles each thing (shell.md §1 step 3). Keep the element ids tests and code use: `#scrim`, `#drawer`, `#drawer-body`, `#drawer-close`, `#drawer-bar-title`.
- **Header.** `.drawer-head` (the block's: `--bar-h` tall, `--panel-pad`, bottom border `--line`), holding `h2#drawer-bar-title` (today's `.dtype`: the type's icon from `TYPE_META`, then its type chip, then the title) and `.end` with the close × last, so the × sits at the header's right edge (`--panel-pad` in). The title is one line that truncates with an ellipsis (`.dtitle`: `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`) and carries its full text as `title`; a long question or decision text is in the properties in full. The body is `.drawer-body#drawer-body`.
- **Inner regions not yet ported keep `no-shell`** (shell.md §1: a ticket that ports an ancestor checks the fenced regions under it). Peeks draw page markup whose class names the block also styles: the progress block's ticket cards and their pills (`progressBlock`, `.pill`), and the goal stepper (`goalStepper`, `.steps`; kit-90 moves it to the block's `goalSteps`). `progressBlock`'s and `goalStepper`'s outermost element get `no-shell` here, so they read as on today's pages; a test compares a ticket pill's and a step's computed style in a peek with the same element on its page. Today's inner `.card small` blocks in openers become `psect` cards (§2.2) or keep `no-shell`, one or the other, never half-styled.
- **The shared scrim.** `#scrim` is also the backdrop of the artifact viewer, a preview and a review (`openArtifact`, `openPreview`, `openReview`), which unhide it and close on its click. The block shows the scrim only under `peek-open`, so the page adds `overlay-open` to `.shell` while one of those is open and a page rule outside the block, `:where(.shell).overlay-open .scrim { opacity: 1; pointer-events: auto }`, shows it for them. The viewer still opens over an open peek and leaves it (`openArtifact`'s "a drawer or a review it was opened over stays, with its scrim"): closing the viewer shows the peek again. A `#talk/` link and a review (`openReview`, which hides an open drawer first) replace the peek, hiding it at once, as today. `overlay-open` is cleared where the viewer and the review are actually closed (`closeArtifact`, `closeReview`, and the preview's close), so a browser Back that closes them clears it too.
- **Motion.** Opening: unhide `#scrim` and `#drawer`, force a style flush, then add `peek-open` to the `.shell` element (`document.body`); the block slides the drawer from `translateX(104%)` to none over `--dur` with `--ease` and fades the scrim. Closing: remove `peek-open` (the block slides it back and holds `visibility` until `--dur` ends), then set `hidden` on both once the drawer's transform transition ends, or after `--dur` if no transition runs (reduced motion: `--dur` 0, so at once). A reopen before that cancels the pending hide. So `#drawer.hidden` keeps meaning "closed" for every caller and test, only now after the slide.
- **Scrim.** The block's `--backdrop` with its 4px `backdrop-filter: blur(4px)`; no page rule overrides it.
- **The top-right button** (kit-87's `.pagebar .tt`): while a peek is open (and Threads isn't, which before kit-89 is always), the owner sees it clear of the scrim with its right edge `--header-pad` left of the peek's left edge, so it doesn't sit under the peek's ×; below 760px it is hidden while a peek is open. The page bar can't lift it: the block makes `.pagebar` sticky at `z-index: 4` with a `backdrop-filter`, which traps a child below the scrim (20) and makes the bar the containing block of a fixed child. So, as the mock does with its `#threads-toggle` on `<body>`, the page draws a mirror, `button#tt-peek` on `<body>` (`position: fixed; top` level with `.tt`, `z-index: 22`), shown only under `.shell.peek-open:not(.threads-open)` and above 760px; its content is copied from `.tt` whenever `.tt` changes (a `MutationObserver`), and its click calls `.tt`'s. While it shows, `.tt` is `visibility: hidden`, so there is one button to see and to reach by keyboard. kit-87's `.pagebar .tt` stays where it is and is unchanged, so its tests and the measure's default `inbox` selector are untouched (peek entries in the measure point `inbox` at nothing; the peek test owns `#tt-peek`'s place). CSS outside the block.
- **Level bars.** The page bar and the peek header are both `--bar-h` tall from the window's top, so their bottom borders are level (the block gives both; the test measures it).

### 2.2 Properties first

`attrs()` (today: `section.attrs` with a `dl`, ID first, then stored fields, Created / Last changed, then an `h4.attrs-h` "Computed" and a second `dl`) is rebuilt on the block's `props()`:

- `section.attrs` holds `dl.props` (ID first; then the stored rows; Created; Last changed; **How it changes**), then, when there are computed rows, `h4.attrs-h` "Computed" and a second `dl.props`. The block styles the keys monospace, with rules between rows and none above the first.
- **A tooltip on every key**: `props()`' `title` on the `dt` (focusable, `tabindex=0`). Stored fields take the schema's doc (`tipFor`, as today); any key without one takes `KEY_TIPS[label]` (a page map covering every label the openers draw, from the mock's `KEY_HELP` and today's tips), else "Stored on the record as `<field>`." The ID's tip says what Copy ID copies. Today's `.attr-k` hover spans go, but their keyboard behaviour stays: a page rule outside the block shows the `dt`'s tip on `:focus-visible` (a positioned `::after` with `content: attr(title)`), and Escape blurs it (replacing today's `.attr-k` Escape case). My call, departing from the mock's per-key info icon: the design names today's tooltips ("as today's `ATTR` config gives"), and an icon on every key adds a column of marks the owner didn't ask for.
- **Every peek kind starts with it**, the ID first: today's openers that start with something else (the file peek's view bar, a sensor's `From` line, an observation's `[data-from]` line, the thread peek's cards, the planner's, the learning record's, the retro's, the wave's and milestone's sub-lines, `notFound`) move it below the properties. The ID is the record's id; for a file its path, a sensor its name, a signal its key, a learning record its id, a planner `plan-<feature>`, a milestone `<goal>/M<n>`, a wave `<feature>/wave-<n>`.
- **How it changes** (`howItChanges(kind, rec)`, one row on every peek). It names a route that works from where the owner is reading (R2). Inside a peek a Shift+click starts nothing (the threads layer finds no subject in the drawer, and `dashboard.test.mjs` holds that "Shift held over the drawer shows no pin"), so where the route is a thread on the record, the row carries a **Start a thread** button (`data-thread-on="<subject kind>:<id>"`, the log's subject kind, not the peek's hash kind: a question is `question:<id>`, never `q:`) that starts the thread pinned to the record exactly as a Shift+click on its card would (`tlStart` with `{ kind: 'item', ref }`). That is possible for the kinds the log takes as item subjects (`T_TYPES`: goal, observation, question, ticket, planner, decision, lesson, problem, act); the button posts nothing (a thread is written only when the owner sends words).
  - act: carried out a decision: "Correct its decision" with a link to the decision's peek (today's hint: the act went as decided, so the call is the decision's; if the act itself went wrong that is a problem); already corrected: "Corrected by <who>: <reason>"; else "Correct, on its row in Self Improvement" with a link to `#loop?lt=act`;
  - decision: already corrected: as for an act; one the owner may correct (today's `mine`): "Correct, on its row in Self Improvement" with a link to `#loop?lt=decide`; else Start a thread;
  - question: defaulted and in the Inbox's Answered list: "Overrule it from its card in the Inbox" with a link (`href="#inbox"`, `data-answered-go="<id>"`; the shell's `parseHead` keeps no unknown state key, so the target rides on the click, as `openQuestion` already does for an open question) that goes to the Inbox, opens `#answered-wrap`, scrolls to the card (answered cards in the Inbox gain `id="a-<qid>"`; `answeredCard(q, { inPeek: true })` draws no id, so the anchor is never doubled) and focuses its Overrule field; any other settled question (answered, withdrawn, or defaulted but older than the list's 80): "Settled; to raise it again," and Start a thread (the supervisor asks again if it should);
  - thread (a message): "Reply in its thread", with a link to `#talk/<thread>` where the message has one;
  - file under governance, process or the strategy: "The supervisor drafts it from your thread; it lands with your yes";
  - goal, ticket, planner, lesson, problem, observation: Start a thread;
  - every other kind (feature, story, release, wave, milestone, signal, learning, retro, sensor, other files), which the log can't take as an item subject: "Shift+click it where it shows on its page and say so in a thread" (a thread on that spot of the page), with a link to its home page.
- **History at the bottom.** `historySection` stays the last thing in every peek's body, on every kind. Today it draws nothing for a `null` peek or one with an error; it then draws its History card with "Nothing logged yet." (missing record) or "Could not load it just now." (transient), so `notFound` peeks end with History too.
- **Sections as cards.** Every section under the properties (today an `h3` and what follows it) is drawn by one helper, `psect(title, html)`, as a `.card` with a `.card-head` title, so the measure's card checks hold in the peek. Content is unchanged.

### 2.3 Nothing permanent in a peek

The only controls in a peek that write are:

- a goal's hold bar: Run, Drain, Park, Let go with its in-place confirm, and Restore on a let-go goal (`holdControl`, as today);
- the goal's impact form ("Wrong?" / "Change it", `data-correct="imp:…"`, owner only, as today);
- today's Correct where a peek draws one (kept until kit-96).

Changes:

- **Lesson / knowledge:** Retire it becomes a button (`data-thread-on="lesson:<id>"`, the same as How it changes' Start a thread) that starts a thread pinned to the lesson, exactly as a Shift+click on the lesson's card would, and posts nothing.
- **Question:** an open question still opens the Inbox at its card (until kit-100 the Inbox page, `#inbox`, scrolled to `#q-<id>`), never a peek. Any other question's peek is read-only. `answeredCard(q, { inPeek: true })` draws no Overrule form, and **every** peek that draws an answered card passes it: the question's own peek and the decision peek's "The answer it rests on" (`restsOn`). Overrule stays on the Inbox's Answered card, which How it changes links to.
- **Mark met** is drawn on the goal card, not in the peek, so the peek has none (it stays on the card; kit-90 owns the goal pages).
- **Rendered / Raw** on a file stays: a view, not a write.

A test (§4) checks every kind: every `button`, `input`, `select`, `textarea` and `form` in the peek's body is on that allow-list or is a non-writing control (a view toggle, a fold-out, a thread starter, a menu), and clicking each non-allowed control posts nothing.

### 2.4 Every detail stays

Each peek keeps everything today's opener for its kind draws, restyled only. The design's inventory ("Every detail and widget stays") is the checklist, one assertion per item in `dashboard-peek.test.mjs`, against a fixture project rich enough to draw each (ticket, goal, feature, story, release, wave, milestone, act, decision, lesson, problem with an incident, signal, observation, learning, retro, thread, planner, question, file, sensor of each kind). Where the fixture can't carry an item (a field the kit never writes in a test project), the test injects the record through the page's own data (`DATA`, `PEEKS`) rather than drop the assertion.

### 2.5 Every row and card opens its record

- **Record cards.** A card that stands for a record carries `data-open="<kind>/<id>"` (today's Loop and Sensors cards already do). Add it to the Board's ticket cards, the incident board's cards and the goal cards; the shared click handler opens the peek on a click anywhere on the card outside its own links and controls (its exclusions gain `summary, details`, so the ⋯ menu's own click never opens the card), and on Enter when the card itself has focus (`tabindex=0`, `role=button`). The ticket and incident cards are `button.tcard` today, and a menu can't nest in a button, so they become `div.tcard[role=button][tabindex=0]`; the page's `button.tcard` rules are re-keyed to `.tcard` so they look the same.
- **Its title opens it.** The title is a link to `#<kind>/<id>`.
- **The ⋯ menu** is today's `cardHead` menu (`details.menu`: the ID, the card's rows, **Copy ID** through the one `[data-copy]` handler, "Copied" or "Select and copy" when the clipboard is refused). It gains **Open in side peek** (`data-menu-open="<kind>/<id>"`, sets the hash) when the card has a peek. Record cards that have no `cardHead` today get the same menu from a small `cardMenu(kind, id)` that returns that `details.menu` markup, so there is one menu and one copy handler on the page and no card shows two ⋯.
- **No Open links.** The goal card's "Open" link goes; every other "Open" link on a card that opens the card's own record goes.
- **Progress rows** open their record's peek on a click or Enter, as Board's ticket cards do.
- **dbTable rows.** Wherever the page draws `dbTable`, it binds `bindDbTable(root, { onOpen })` and maps the row index to its record's peek (`peekFor(kind, id)`: the hash that opens that kind's peek: `#<kind>/<encoded id>`, and for a file `#file?path=<encoded path>`; every record a table lists today has one). Today no page draws one yet (kit-90 onward do), so a vm check proves the page's half (`peekFor` gives the opener's hash for every `OPENERS()` kind, and `route()` opens it), and the test proves the binder's half on `test/fixtures/dashboard-shell.html` by loading the fixture, binding the table with an `onOpen` that opens its row's record in the fixture's drawer through the block, and checking a click and an Enter each open it. **Open question for the supervisor:** the fixture is not in `touches`; the test does this by evaluating script in the loaded fixture, which needs no change to it. If the reviewer reads the done-when as needing the fixture itself to open peeks, the fixture must join `touches` (design-change).

### 2.6 The measure

`test/dashboard-measure.test.mjs`: add one peek of each kind to `PAGES` (opened over its home page), each measured at 1440x900, 720x800 and 390x844 on every check shell.md §9 names. What each check judges there, as `measure.mjs` is built (it isn't in touches and doesn't change): `page-top` and `header-pad` judge the page bar and the page under the peek (the default `view`; `inbox` is pointed at a selector that matches nothing for peek entries, since the top-right button has moved left of the peek on purpose and the peek test owns its place); `prose`, `head-h` and `head-end` judge the peek's own text and card heads; `overflow` and `uneven` skip the drawer by design (it scrolls, and `uneven` leaves out `.drawer` cards). The peek entries use a second project seeded with the peek fixture, so kit-87's pages keep measuring on their own data.

## 3. Acceptance checks (the done-whens)

1. `test/dashboard-peek.test.mjs` passes in CI (headless Chrome): opening a peek runs a transform transition on the drawer from off-screen (a positive translateX of at least its width, read before `peek-open`) to `none`, whose `CSSTransition` (`drawer.getAnimations()`) has duration `--dur` and easing `--ease`; closing runs the reverse transition, and `#drawer` gets `hidden` only after its `transitionend`; under `prefers-reduced-motion: reduce` (emulated) `--dur` is 0 and no transition runs. With no peek open, the artifact viewer and a review still show the scrim (opacity 1) and a click on it closes them; the viewer opened over a peek leaves the peek there when it closes.
2. Same test: `.drawer-head` and `.pagebar` are each `--bar-h` tall with their bottom edges within 1px; the close × ends `--panel-pad` (±1px) from `.drawer-head`'s right edge; a long title stays on one line inside the header; while a peek is open the top-right button the owner sees (`#tt-peek`, mirroring `.pagebar .tt`, above the scrim, its click `.tt`'s) has its right edge left of the drawer's left edge, and below 760px neither shows; a ticket pill and a goal step in a peek have the same computed style as on their page.
3. Same test: on every peek kind, `#drawer-bar-title` holds the kind's `TYPE_META` icon before its type chip.
4. Same test: on every peek kind the body's first element is `section.attrs`, whose first `dt` is ID; every `dt` has a non-empty `title` and shows it on keyboard focus; the `dt`s' computed font family is the mono stack; the first `dt`/`dd` have no top border; a `dt` reads "How it changes" with the case's route (§2.2, each case in the fixture: an act under a decision, a corrected act, a decision the owner may correct and one they may not, a defaulted question in the list, an answered one, a withdrawn one); each Start a thread starts a draft pinned to its record and posts nothing; the body's last section is History, a missing record's included. No peek renders a writing control except those in §2.3 (the fixture's decision rests on a defaulted question, so its "The answer it rests on" is checked too); an answered, defaulted or withdrawn question's peek is read-only; following an open question's link opens the Inbox at its card.
5. Same test: one assertion per item of the design's peek inventory (§2.4); Retire it starts a thread draft pinned to the lesson and posts nothing; a defaulted question's peek has no Overrule control and its link opens the Answered list at its card, focused on that card's Overrule.
6. Same test: on `test/fixtures/dashboard-shell.html`, a click or Enter on a dbTable row opens its record's peek, and `peekFor` gives every opener kind's hash; on today's pages a click or Enter on a ticket card or a Progress row opens its peek; a card's title opens its peek, and so does Open in side peek in its ⋯ menu, which also has Copy ID; a click on the ⋯, a link or a control inside a card does only its own thing; no card shows two ⋯; no card has a separate Open link.
7. Same test: the scrim's computed background is `--backdrop` and its `backdrop-filter` is `blur(4px)`.
8. `test/dashboard-measure.test.mjs` passes in CI with one peek of each kind in `PAGES`, at the three sizes, on every check shell.md §9 names.
9. The existing tests in `touches` that read the drawer pass (updated only where the markup moved: `.drawer-bar` → `.drawer-head`, `hidden` after the slide, Retire it in the peek).

## 4. Contracts

- Consumed: `dashboard-shell@1`. Neither block changes (shell.md: no ticket before kit-95 edits them). Everything new is page CSS and JS outside the blocks.
- Provided: none. `cardMenu`, `psect`, `howItChanges`, `KEY_TIPS`, `peekFor`, `peekShow`/`peekHide` are page-internal; later page tickets (kit-90 onward) call them.

## Review dispositions

spec-2 (`reviews/spec-2.md`): S1 the mirror `#tt-peek` on `<body>`, `.pagebar .tt` unchanged (§2.1); S2 `openReview` named with `#talk/` as hiding the peek, `overlay-open` cleared in the close functions (§2.1); S3 no `a-<qid>` id in peeks (§2.2); S4 Start a thread carries the log's subject kind, `question:<id>` (§2.2).

spec-1 (`reviews/spec-1.md`): F1 the shared scrim (`overlay-open`), viewer-over-peek kept (§2.1, AC1); F2 question routes per case, answered-card anchors, older defaulted → a thread (§2.2, §5); F3 `answeredCard(…, { inPeek })` in every peek caller, fixture decision on a defaulted question (§2.3, AC4); F4 act/decision routes per case (§2.2); F5 Start a thread in How it changes for item kinds, a page-spot route for the rest (§2.2); F6 `no-shell` on `progressBlock` and `goalStepper`, compared in AC2 (§2.1); F7 one menu, `cardHead`'s, with Open in side peek; `summary, details` excluded; `button.tcard` re-keyed (§2.5); F8 what each measure check judges in a peek (§2.6); F9 one-line truncating title (§2.1); F10 tips on keyboard focus, departure from the mock's icon stated (§2.2); F11 History on missing and failed peeks (§2.2); F12 vm check of `peekFor` (§2.5, AC6).

## 5. Edge cases

- A redraw while the peek is open (the 10-second refresh) never re-runs the slide: `peek-open` stays set; only a closed drawer animates in.
- Open, then close and reopen within `--dur`: the pending hide is cancelled; the drawer ends open.
- Peek inside a peek (a link in a peek): the drawer stays open and redraws; no slide.
- A peek whose record isn't found (`notFound`): properties with the ID, How it changes, the note, History.
- Copy ID where the clipboard API is refused: today's `[data-copy]` handler says "Select and copy", with the id shown in the menu to select.
- A defaulted question beyond the Answered list's 80: its peek offers Start a thread, not a dead link (the list's length is the server's, `devteam.mjs`, out of scope).
- A card inside `.no-shell` regions kit-87 left: its ⋯ menu and `data-open` work the same (they are page JS, not block CSS).
- Shift+click on a card still starts a thread (the click handler already returns on Shift).
- Reduced motion: the top-right button moves with no transition.

## 6. Out of scope

- The Threads sidebar and the peek stopping at its edge (kit-89); the Inbox in the panel (kit-100; until then "the Inbox" is the `#inbox` page).
- The goal peek's `goal-peek` marker block and Upkeep's peek (kit-90); Correct as a thread (kit-96).
- Peeks' own tabs as history entries (the follow-on goal).
- Copy removal beyond what this ticket's markup moves (kit-95), except the peeks' hint lines that "How it changes" replaces ("To correct it, use Correct on it in Loop → Act.").
- Any change to either shell block, `hub.html`, or `devteam.mjs`.

## 7. Open points for the supervisor

1. Settled by `m-20261115-195457593-supervisor` (below). `test/dashboard-owner-action.test.mjs` clicks the lesson peek's Retire it and expects a `POST /api/knowledge` (its lines ~151–155). §2.3 makes that button start a thread, so that test must change: its positive control moves to the Inbox lesson card's Retire it, which still posts. Recommendation: add `test/dashboard-owner-action.test.mjs` to `touches`.
2. `test/fixtures/dashboard-shell.html` (§2.5): recommendation: leave it out; the test wires the fixture's table in the loaded page.

## Rulings

- `m-20261115-195457593-supervisor`: `test/dashboard-owner-action.test.mjs` is in touches. It keeps a test that the peek's Retire it starts a thread and posts nothing to `/api/knowledge`, beside the moved positive control (the Inbox lesson card's Retire it, which posts).

- `m-20261115-195003493-supervisor`: plan ahead (spec and plan now; the mock at main is the reference); build nothing until kit-87 has merged and approve-plan is recorded; briefs carry lessons `k-20261115-182656232`, `k-20261115-080753394`, `k-20261115-164245020` and the scripts-in-files rule; run only touched files at `--test-concurrency=2`.
