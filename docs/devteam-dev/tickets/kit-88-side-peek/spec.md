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
- **Header.** `.drawer-head` (the block's: `--bar-h` tall, `--panel-pad`, bottom border `--line`), holding `h2#drawer-bar-title` (today's `.dtype`: the type's icon from `TYPE_META`, then its type chip, then the title) and `.end` with the close × last, so the × sits at the header's right edge (`--panel-pad` in). The body is `.drawer-body#drawer-body`.
- **Motion.** Opening: unhide `#scrim` and `#drawer`, force a style flush, then add `peek-open` to the `.shell` element (`document.body`); the block slides the drawer from `translateX(104%)` to none over `--dur` with `--ease` and fades the scrim. Closing: remove `peek-open` (the block slides it back and holds `visibility` until `--dur` ends), then set `hidden` on both once the drawer's transform transition ends, or after `--dur` if no transition runs (reduced motion: `--dur` 0, so at once). A reopen before that cancels the pending hide. So `#drawer.hidden` keeps meaning "closed" for every caller and test, only now after the slide. Routes that replace the peek with something else (a `#talk/` link, the artifact viewer, a review) hide it at once, as today.
- **Scrim.** The block's `--backdrop` with its 4px `backdrop-filter: blur(4px)`; no page rule overrides it.
- **The top-right button** (kit-87's `.pagebar .tt`): while a peek is open (and Threads isn't, which before kit-89 is always), it sits above the scrim with its right edge `--header-pad` left of the peek's left edge, so it doesn't sit under the peek's ×; below 760px it is hidden while a peek is open. CSS outside the block, keyed to `.shell.peek-open:not(.threads-open)`.
- **Level bars.** The page bar and the peek header are both `--bar-h` tall from the window's top, so their bottom borders are level (the block gives both; the test measures it).

### 2.2 Properties first

`attrs()` (today: `section.attrs` with a `dl`, ID first, then stored fields, Created / Last changed, then an `h4.attrs-h` "Computed" and a second `dl`) is rebuilt on the block's `props()`:

- `section.attrs` holds `dl.props` (ID first; then the stored rows; Created; Last changed; **How it changes**), then, when there are computed rows, `h4.attrs-h` "Computed" and a second `dl.props`. The block styles the keys monospace, with rules between rows and none above the first.
- **A tooltip on every key**: `props()`' `title` on the `dt`. Stored fields take the schema's doc (`tipFor`, as today); any key without one takes `KEY_TIPS[label]` (a page map covering every label the openers draw, from the mock's `KEY_HELP` and today's tips), else "Stored on the record as `<field>`." The ID's tip says what Copy ID copies. Today's custom `.attr-k` hover spans go.
- **Every peek kind starts with it**, the ID first: today's openers that start with something else (the file peek's view bar, a sensor's `From` line, an observation's `[data-from]` line, the thread peek's cards, the planner's, the learning record's, the retro's, the wave's and milestone's sub-lines, `notFound`) move it below the properties. The ID is the record's id; for a file its path, a sensor its name, a signal its key, a learning record its id, a planner `plan-<feature>`, a milestone `<goal>/M<n>`, a wave `<feature>/wave-<n>`.
- **How it changes** (`howItChanges(kind, record)`, one row on every peek):
  - act, decision: "Correct, on its row in Self Improvement" (today's Correct lives on the Loop's rows; kit-96 moves it to a thread);
  - question: answered or defaulted: "Overrule it from its card in the Inbox's Answered list" with a link to that card; withdrawn: "Withdrawn: nothing changes it";
  - thread (a message): "Reply in its thread";
  - file under governance, process or the strategy: "The supervisor drafts it from your thread; it lands with your yes";
  - every other kind: "Shift+click it and say so in a thread".
- **History at the bottom.** `historySection` stays the last thing in every peek's body, on every kind (today it is on all but a few early returns; each gets it).
- **Sections as cards.** Every section under the properties (today an `h3` and what follows it) is drawn by one helper, `psect(title, html)`, as a `.card` with a `.card-head` title, so the measure's card checks hold in the peek. Content is unchanged.

### 2.3 Nothing permanent in a peek

The only controls in a peek that write are:

- a goal's hold bar: Run, Drain, Park, Let go with its in-place confirm, and Restore on a let-go goal (`holdControl`, as today);
- the goal's impact form ("Wrong?" / "Change it", `data-correct="imp:…"`, owner only, as today);
- today's Correct where a peek draws one (kept until kit-96).

Changes:

- **Lesson / knowledge:** Retire it becomes a button (`data-thread-on="lesson:<id>"`) that starts a thread pinned to the lesson, exactly as a Shift+click on the lesson's peek would (`tlStart` with the lesson's subject), and posts nothing. The peek's properties carry the lesson's `data-subject`.
- **Question:** an open question still opens the Inbox at its card (until kit-100 the Inbox page, `#inbox`, scrolled to `#q-<id>`), never a peek. Any other question's peek is read-only: its answered card is drawn without the Overrule form, and "How it changes" links to the question's card in the Inbox's Answered list, where Overrule stays.
- **Mark met** is drawn on the goal card, not in the peek, so the peek has none (it stays on the card; kit-90 owns the goal pages).
- **Rendered / Raw** on a file stays: a view, not a write.

A test (§4) checks every kind: every `button`, `input`, `select`, `textarea` and `form` in the peek's body is on that allow-list or is a non-writing control (a view toggle, a fold-out, a thread starter, a menu), and clicking each non-allowed control posts nothing.

### 2.4 Every detail stays

Each peek keeps everything today's opener for its kind draws, restyled only. The design's inventory ("Every detail and widget stays") is the checklist, one assertion per item in `dashboard-peek.test.mjs`, against a fixture project rich enough to draw each (ticket, goal, feature, story, release, wave, milestone, act, decision, lesson, problem with an incident, signal, observation, learning, retro, thread, planner, question, file, sensor of each kind). Where the fixture can't carry an item (a field the kit never writes in a test project), the test injects the record through the page's own data (`DATA`, `PEEKS`) rather than drop the assertion.

### 2.5 Every row and card opens its record

- **Record cards.** A card that stands for a record carries `data-open="<kind>/<id>"` (today's Loop and Sensors cards already do). Add it to the Board's ticket cards and the goal cards; the shared click handler opens the peek on a click anywhere on the card outside its own links and controls, and on Enter when the card has focus (`tabindex=0`, `role=button`).
- **Its title opens it.** The title is a link to `#<kind>/<id>`.
- **The ⋯ menu.** Each record card's head ends with a ⋯ button (`data-card-menu`) opening a small menu with **Open in side peek** (sets the hash) and **Copy ID** (writes the id to the clipboard and says "Copied"). One helper, `cardMenu(kind, id)`, and one delegated handler; Escape or a click elsewhere closes it.
- **No Open links.** The goal card's "Open" link goes; every other "Open" link on a card that opens the card's own record goes.
- **Progress rows** open their record's peek on a click or Enter, as Board's ticket cards do.
- **dbTable rows.** Wherever the page draws `dbTable`, it binds `bindDbTable(root, { onOpen })` and maps the row index to its record's peek (`peekFor(kind, id)`: the hash of that kind's opener; every record a table lists today has one). Today no page draws one yet (kit-90 onward do); the test proves the wiring on `test/fixtures/dashboard-shell.html` by loading the fixture, binding the table with an `onOpen` that opens its row's record in the fixture's drawer through the block, and checking a click and an Enter each open it. **Open question for the supervisor:** the fixture is not in `touches`; the test does this by evaluating script in the loaded fixture, which needs no change to it. If the reviewer reads the done-when as needing the fixture itself to open peeks, the fixture must join `touches` (design-change).

### 2.6 The measure

`test/dashboard-measure.test.mjs`: add one peek of each kind to `PAGES` (opened over its home page), each measured at 1440x900, 720x800 and 390x844 on every check shell.md §9 names. Peek-specific ignores only where the check is about the page under it (`page-top` measures the page, which the peek covers; the peek's own card heads, running text and overflow are measured).

## 3. Acceptance checks (the done-whens)

1. `test/dashboard-peek.test.mjs` passes in CI (headless Chrome): opening a peek moves the drawer's computed transform from off-screen (a positive translateX of at least its width) to `none`/identity over `--dur` with `--ease` (`transition-duration`, `transition-timing-function` read from the computed style, and an intermediate sample mid-way); closing reverses it, and `#drawer` gets `hidden` only after; under `prefers-reduced-motion: reduce` (emulated) `--dur` is 0 and no transition runs.
2. Same test: `.drawer-head` and `.pagebar` are each `--bar-h` tall with their bottom edges within 1px; the close × ends `--panel-pad` (±1px) from the header's right edge; the top-right button's right edge is left of the drawer's left edge while a peek is open, and it is hidden (not rendered or zero-size) below 760px.
3. Same test: on every peek kind, `#drawer-bar-title` holds the kind's `TYPE_META` icon before its type chip.
4. Same test: on every peek kind the body's first element is `section.attrs`, whose first `dt` is ID; every `dt` has a non-empty `title`; the `dt`s' computed font family is the mono stack; the first `dt`/`dd` have no top border; a `dt` reads "How it changes"; the body's last section is History. No peek renders a writing control except those in §2.3; an answered, defaulted or withdrawn question's peek is read-only; following an open question's link opens the Inbox at its card.
5. Same test: one assertion per item of the design's peek inventory (§2.4); Retire it starts a thread draft pinned to the lesson and posts nothing; a defaulted question's peek has no Overrule control and links to its Inbox card, which has one.
6. Same test: on `test/fixtures/dashboard-shell.html`, a click or Enter on a dbTable row opens its record's peek; on today's pages a click or Enter on a ticket card or a Progress row opens its peek; a card's title opens its peek, and so does Open in side peek in its ⋯ menu, which also has Copy ID; no card has a separate Open link.
7. Same test: the scrim's computed background is `--backdrop` and its `backdrop-filter` is `blur(4px)`.
8. `test/dashboard-measure.test.mjs` passes in CI with one peek of each kind in `PAGES`, at the three sizes, on every check shell.md §9 names.
9. The existing tests in `touches` that read the drawer pass (updated only where the markup moved: `.drawer-bar` → `.drawer-head`, `hidden` after the slide, Retire it in the peek).

## 4. Contracts

- Consumed: `dashboard-shell@1`. Neither block changes (shell.md: no ticket before kit-95 edits them). Everything new is page CSS and JS outside the blocks.
- Provided: none. `cardMenu`, `psect`, `howItChanges`, `KEY_TIPS` are page-internal; later page tickets (kit-90 onward) call them.

## 5. Edge cases

- A redraw while the peek is open (the 10-second refresh) never re-runs the slide: `peek-open` stays set; only a closed drawer animates in.
- Open, then close and reopen within `--dur`: the pending hide is cancelled; the drawer ends open.
- Peek inside a peek (a link in a peek): the drawer stays open and redraws; no slide.
- A peek whose record isn't found (`notFound`): properties with the ID, How it changes, the note, History.
- Copy ID where the clipboard API is refused: the menu says "Couldn't copy" and shows the id selected.
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

1. `test/dashboard-owner-action.test.mjs` (not in `touches`) clicks the lesson peek's Retire it and expects a `POST /api/knowledge` (its lines ~151–155). §2.3 makes that button start a thread, so that test must change: its positive control moves to the Inbox lesson card's Retire it, which still posts. Recommendation: add `test/dashboard-owner-action.test.mjs` to `touches`.
2. `test/fixtures/dashboard-shell.html` (§2.5): recommendation: leave it out; the test wires the fixture's table in the loaded page.

## Rulings

- `m-20261115-195003493-supervisor`: plan ahead (spec and plan now; the mock at main is the reference); build nothing until kit-87 has merged and approve-plan is recorded; briefs carry lessons `k-20261115-182656232`, `k-20261115-080753394`, `k-20261115-164245020` and the scripts-in-files rule; run only touched files at `--test-concurrency=2`.
