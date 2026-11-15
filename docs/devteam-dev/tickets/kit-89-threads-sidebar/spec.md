# kit-89-threads-sidebar: spec

Threads becomes a full-height side panel with real tabs, opened from the top-right Inbox button with its counts; threads started on a thing keep floating beside it.

- Ticket: `kit-89-threads-sidebar` (feature `dashboard-cleanup`, stories DCL-S3 and DCL-S4, kind build, size M, risk normal)
- Waits on: `kit-88-side-peek` (and through it `kit-87-pages-and-sidebar`): kit-87 gives the frame (`shell` on `<body>`, `.main`, `.pagebar` with `.tt`, one page at a time, the router on `parseHead`/`stampFor`/`closeTarget`/`withPage`, `talk/` over its subject's page, the `<page>?th=inbox → inbox` redirects); kit-88 gives the peek frame (`peek-open`, the drawer's slide, `overlay-open` while the viewer, a preview or a review is up, and the mirror `#tt-peek` on `<body>` that stands in for `.tt` while a peek is open)
- Consumes: `docs/devteam/dashboard/shell.md@1` (tokens `--threads-w`, `--bar-h`, `--panel-pad`, `--backdrop`, `--ease`, `--dur`, `--line-2`; the Threads frame `.threads`, `.threads-head`, `.threads-body`, `.thread-list`; `threads-open` on the `.shell` element; `tabBar`, `bindTabBar`, `threadsTabs`, `.seg`; the URL keys `th` and `t`; `withPage`; the measure). Provides no contract. Neither shared block changes: everything here is the page's own CSS and JS, outside `devteam-layout` and `devteam-shell-js`.
- Design: home's `project/designs/a-cleaner-more-consistent-dashboard.md`, sections `dashboard-shell@1` (History state, The URL, Remembered filters, The sidebar, One header height, The Threads sidebar, Threads tabs), Nav, pages and settings (the top-right button), Threads, The artifact viewer and the panel, The measure test. The mock `project/artifacts/dashboard-cleanup/` (home, main) is the reference for the look (ruling `m-20261115-203750802-supervisor`: plan ahead, build once kit-88 has merged and approve-plan is recorded).
- Written ahead of the build. The build re-reads this spec and the plan against main once kit-87 and kit-88 have merged; anything they landed differently from what is quoted here is reconciled then (and a real conflict goes to the supervisor).

## 1. Why

Today the owner reaches threads through a small dock pill at the bottom right (`#tl-pill`) that opens a 320px panel (`#tl-panel`): every open thread, numbered as its pin, then a Resolved fold-out. A thread with no subject opens in a card stuck to the dock. The owner settled the replacement in the mock (threads `t-20261115-010826979-owner`, `t-20261115-013510326-owner`, `t-20261114-230400232-owner`, `t-20261115-020154848-owner`): one full-height panel on the right with real tabs, opened from the top-right Inbox button, which also tells them at a glance whether anything waits on them; a thread with no subject read in the panel; and threads started on a thing still floating beside it. The page moves over to make room, and a side peek stops at the panel's edge, so the owner can talk about what they are reading.

## 2. What changes (index.html only, plus tests)

### 2.1 The panel

- **Markup.** One `<aside class="threads" id="threads" aria-label="Threads">`, a child of `<body>` outside `.app` (so it also shows in the `/view/` tab, where `.app` is hidden; §2.8), holding:
  - `.threads-head` (the block's: `--bar-h` tall, `--panel-pad`, bottom border `--line`): `#th-tabs`, the tab bar, then `.end` with three icon buttons: Pin (`#tl-pinbtn`, today's pin mode, `aria-pressed`), New thread (`[data-tl-new]`), and close × (`#th-close`, `aria-label="Close Threads"`), last, so it ends `--panel-pad` from the panel's right edge;
  - `.threads-body#th-body`: the selected tab's pane.
- **Open and closed.** The panel is open while the route's page head carries `th` (§2.5). Open: `threads-open` on the `.shell` element (`document.body`); the block slides `.threads` in with `--ease`/`--dur`, and gives `.main` a right margin of `--threads-w`, so the page moves left by `--threads-w`; with a peek open, the drawer's and scrim's `right` become `--threads-w` too, so the peek's right edge meets the panel's left edge and the scrim covers only the page. Below 900px `--threads-w` is `100vw` and the block drops the margin, so the panel overlays the page. Nothing here restyles the block's frame; the page only adds and removes `threads-open`.
- **The tabs**, registered once through the block's `threadsTabs.register` and drawn with `tabBar({ tabs: threadsTabs.list() + waiting flags, selected })`, bound with `bindTabBar`:
  1. `threads`, label Threads, `count()` the number of your-move threads (§2.3), drawn blue (`waiting: true`);
  2. `supervisor`, label Supervisor, `disabled`, titled "The supervisor's terminal: the follow-on goal";
  3. `shell`, label Shell, `disabled`, titled "A plain shell at the repo root: the follow-on goal".
  Disabled tabs can't be selected (the block skips them). `kit-100` registers Inbox before Threads; nothing here assumes Threads is first except today's `selected` default.
- **The Threads pane** (`threadsTabs.render('threads', el)`), top to bottom:
  - `#ask-threads`: what the supervisor's terminal is asking, today's `askHtml()` card, drawn by `askDraw()` (which today writes `#ask-dock`; the list of targets becomes `ask-inbox`, `ask-threads`, `tl-c-ask`). So the terminal's question is at the top of Threads, where the dock had it;
  - the Open / Resolved split button: the block's `.seg` (`role="group"`, `aria-label="Which threads"`), two buttons `[data-thf="open"]` and `[data-thf="resolved"]` with `aria-pressed`, each with its count: Open, every open thread; Resolved, the resolved ones listed (today's last 50 by `resolved_at`);
  - the list (`ul.thread-list#tl-list`, the block's `--line-2` rule between items, none after the last) of the picked threads (§2.3), or one empty line ("No open threads. Hold Shift and click anything on the page, or start one with +." / "Nothing resolved yet.");
  - or, in place of the split button and the list, one thread (§2.4).
- **Redraws.** The pane is rewritten only when its HTML changed and nothing in it is focused or pressed (today's `tlHeld` rule for the dock list, kept), so the 10-second redraw and the threads poll never drop a focus, a press or half-typed words.

### 2.2 The top-right Inbox button

kit-87's `.pagebar .tt` (and kit-88's mirror `#tt-peek`, which copies `.tt`'s content) reads:

- the inbox icon and "Inbox";
- the red count of open questions (kit-87's, unchanged);
- the thread count, `span.n.th` with one class for the most pressing state (owner, `m-20261115-011711428-supervisor`):
  - `ok` (green): when any open thread is ready to accept, it counts the ready ones plus the your-move ones; title "N ready to accept, M your move" (", M your move" only when M > 0);
  - else `you` (blue): when any is your move, it counts those; title "M your move";
  - else `wait` (grey): it counts the open threads, all waiting on the supervisor; title "N waiting on the supervisor";
  - none when there is no open thread.
  Each count is in the button's accessible name (`aria-label`, for example "Inbox: 3 open questions, 2 ready to accept, 1 your move"), since colour alone carries the state.
- Every open thread counts, floating ones (a subject on the page, an artifact or a preview) included.
- **Pressing it** opens the panel on Threads (`th=open`; until `kit-100` adds the Inbox tab before it, design § Threads). A `th=inbox` head still goes to the Inbox page through kit-87's redirect entries, which stay until `kit-100`.
- **While the panel is open the button hides** (`visibility: hidden` on `.tt` and `#tt-peek` under `.shell.threads-open`, so it is neither seen nor reached by keyboard), and the panel's × closes the panel (owner, thread `t-20261115-013510326-owner`).
- The counts are drawn wherever the threads or the questions are redrawn (`tlDraw()`, the 10-second `render()`), only when they changed (a button rewritten on every poll would drop a press).

### 2.3 The list and its three states

From today's thread data only (`/api/threads`, as `TL.threads` holds it with the owner's pending presses laid over); nothing new is stored. An open thread is in exactly one state, by the rule `kit-84` uses for the hub's `threads: { you, waiting, ready }`, so the button here and the project's hub tab always agree:

| State | When | Mark | Headline |
|---|---|---|---|
| ready to accept | `t.ready` (the supervisor proposed resolving it and the owner has said nothing since) | a small green check, `.th-st.ok` (`icon-check`) | regular |
| your move | else `t.waiting === 'owner'` (the supervisor spoke last, or there are no turns) | a filled blue dot, `.th-st.you` | bold |
| waiting on the supervisor | else | a hollow grey dot, `.th-st.wait` | regular |

`tState(t)` (one function, in the page's own JS outside `threads-core`, so the vm tests of `threads-core` are untouched) gives the state; the button's count, the Threads tab's count and the marks all read it. Each mark is `role="img"` with an `aria-label` and a `title` that say the state ("Ready to accept", "Your move", "Waiting on the supervisor"); there is no explanatory line under a row (owner, `m-20261115-011334263-supervisor`).

Read marks: today's per-browser `devteam.thread.seen` drives the dock's unread dot. The owner's three states replace that dot, and "your move" follows the server's rule (the supervisor spoke last, read or not) so the counts match the hub, which can't see a browser's marks (kit-84's spec, F1-4). The marks stay written (the card still calls `tlSeen`); nothing reads them for the list. My call; the design names "read marks" among the inputs, and this is the reading that keeps one count everywhere.

**A row** (`li > button.th-row[data-tl-open="<id>"]`, one button per row so the list is a list of controls): the mark; for a thread with a pin on the page (a subject `tPins` numbers), the pin's number in a `.pinchip`; the subject line (`tWhere(subject)`, "no subject" left out for a subjectless thread, plus " · subject gone" when an item's subject isn't drawn, as today); the time since its last activity (`activity_at`, short form); and the headline, its title (`t.title`), one line truncated. Resolved rows carry no state mark and no pin. Open rows are ordered newest activity first (today's order); the pin numbers are by when each began (today's `tPins`), so a row's number is its pin's.

### 2.4 Opening a thread

- **A thread with no subject** (and one whose subject isn't drawn anywhere it could be shown: today's "in the dock" case, `tPlace` unasked because `tlTargetRect` gives none) opens **in the panel**: the pane shows, in place of the split button and the list, a back arrow (`button[data-tl-back]`, `aria-label="Back to the threads"`) with the thread's title, then today's card body (turns, the ready proposal, Resolve, Reopen, the composer, its errors, `#tl-c-ask`). This is today's `#tl-card`, moved: `tlCard()` reparents the one `#tl-card` element into the pane (`.in-panel`) or back into `#tl` (floating), so every id and handler it has keeps working and there is never a second composer. The arrow goes back to the list (§2.5).
- **A new thread from the panel** (+): the pane shows the same in-panel card as a draft with no subject, focused on its composer; its first Send starts the thread (today's `tlSend`), and the pane then shows that thread.
- **A thread with a subject on the page** (Shift+click, the pin mode, or a Start a thread button of kit-88's) keeps today's floating `#tl-card` beside its numbered pin, placed by `tPlace` with the window narrowed by `--threads-w` while the panel is open above 900px (the call site passes `innerWidth − 380`, read from the token; `tPlace` itself is unchanged), so the card never sits under the panel. It is also listed (§2.3) with its pin and subject. While its card is open, its row is marked (`aria-current="true"`, `.on`), and the panel, if open, stays on the list.
- **Clicking a floating thread's row** goes to its subject (kit-87's `tlGoTo`: the subject's page as a new entry, its Loop tab, scrolled into view) and opens its card there; on an artifact or preview subject, today's stage behaviour (`#artifact/…`, `#preview/…`). A peek that was open closes by that navigation. Its pin is marked while the card is open.
- **A pin** still opens its thread's card in place (today's `[data-tl-pin]`).
- **Under 640px** the floating card is today's bottom sheet; the in-panel card fills the panel.

### 2.5 The URL, history and the remembered state

The `th` and `t` keys of a page head (shell.md §6), on every page:
- `th=open` or `th=resolved`: the panel is open on Threads with that list. (`th=inbox` is kit-87's redirect to the Inbox page until `kit-100`.)
- `t=<id>`: the open thread. A thread shown in the panel has `th` too; a floating thread's card may be open with the panel closed (`t` alone).

**Each change is a history entry** (shell.md §7): opening or closing the panel, picking Open or Resolved, opening a thread (from the list, a pin, or the in-panel back arrow back to the list) each assign `location.hash` to the current page head with the new `th` and `t`, so Back walks them. The router (kit-87's `route()`) reads them on every page head and draws the panel and the card from them: the router, not the click, opens and closes things, so Back, Forward and a reload all go through one path.
- Back after opening a thread returns to the list (`th` kept, `t` gone).
- Closing a floating card (×, Escape) removes `t` with a new entry; a card opened by a `talk/` link keeps kit-87's close (`closeTarget`).
- **Under an open peek** the entry is the peek's link head, which has no state keys, so a Threads change updates `history.state.page` with the block's `withPage` (by `replaceState`) and adds no entry; a reload reopens the peek over its page with the panel open on that thread, since kit-87's router shows the recorded page head (with its `th`, `t`) under the peek. Closing the peek returns to that page head, panel and thread still open.
- **A `talk/<id>` link** to a thread with no subject (or whose subject isn't drawn) opens the panel on that thread over the page it was clicked on (cold: Overview): kit-87's in-place rewrite of the `talk/` entry's recorded page gets `th=open&t=<id>`. A `talk/` link to a thread with a subject keeps kit-87's behaviour (its card over its subject's page), with `t` added to that page head.
- **Remembered** (`devteam.threads.open`, one `localStorage` key, `{ th, t }` or absent; shell.md §8 "the Threads panel's open state"): written on every route from the head's `th` and `t` (absent when the panel is closed and no card is open). Applied only to a fresh entry (a cold load, a nav click, a link: one with no `history.state` yet) whose head carries neither `th` nor `t`: the router writes the stored keys into that entry's hash at once (`replaceState`). So the panel stays open, on the same thread, as the owner moves between pages, and a fresh visit opens it as they left it; an entry reached by Back or Forward shows exactly its own keys. A stored `t` for a thread `/api/threads` doesn't have is dropped (the list shows). A throwing store does nothing.
- `parseHead` keeps `th` only as `open`, `resolved` or `inbox` and `t` only as a thread id (`[a-z0-9-]{1,80}`); anything else is the control's default (closed, no thread).

### 2.6 The dock goes

`#tl-dock`, `#tl-panel`, `#tl-pill`, `#ask-dock`, the `.tl-dock`, `.tl-pill`, `.tl-panel`, `.tl-dock-head`, `.tl-row`, `.tl-resolved` and `.tl-card.in-dock` rules, `tlDock()`'s pill and list, and the `#tl-pill` click handling are removed. What they did moves:

| Today | From this ticket |
|---|---|
| the pill's open-thread count and unread dot | the Inbox button's thread count (§2.2) and the rows' marks (§2.3) |
| the pill's "terminal asking" badge and `#ask-dock` | `#ask-threads` at the top of the Threads pane, plus `#ask-inbox` on the Inbox page and `#tl-c-ask` on the open card, as today |
| the panel's Pin and New thread | the panel head's Pin and + |
| the panel's open list and Resolved fold-out | the Open / Resolved split button and the list |
| a subjectless card in the dock | the in-panel thread |
| a list row's click | the row's click (§2.4) |

The `#tl` layer (the cursor, highlight, chip, pins and the floating card) stays `no-shell` and keeps its look. The card, its turns, pins and composer keep today's look (design § Threads). Thread data, `/api/threads` and the thread actions don't change. `threads-core`'s functions are not changed (its vm tests must still pass); the words in its comments that say "dock" may be left.

### 2.7 With the artifact viewer up

The in-dashboard viewer (`#artifact-view`, its preview stage included) shows over the page with kit-88's `overlay-open` and the scrim.

- **The Inbox button floats above it**: the page adds `av-open` to the `.shell` element in `openArtifact` and `openPreview` and clears it where they close (`closeArtifact` and the preview's close, beside kit-88's `overlay-open`). Under `.shell.av-open:not(.threads-open)` the mirror `#tt-peek` shows at the button's own place (top `--bar-h`/2, centred, right `--header-pad`), above the viewer (`z-index` above `#artifact-view`'s), and `.tt` itself is hidden; so the button the owner sees is at the window's top right, and its click opens the panel. The viewer draws no Inbox button of its own.
- **The panel opens beside it**: under `.shell.av-open`, `.threads` sits above the viewer and its scrim (a page rule raising its `z-index`), so it is not dimmed.
- **`--av-right`**: while the panel is open above 900px, the `.shell` element sets `--av-right: calc(var(--threads-w) + 16px)` (a page rule: `@media (min-width: 901px) { :where(.shell).threads-open { --av-right: … } }`). Narrowing the viewer by it is `kit-141`'s (artifact-annotations), as agreed in `m-20261115-025552805-plan-artifact-annotations`; this ticket only sets the variable. Below 900px the panel overlays the viewer.
- **The backdrop** behind the viewer is `#scrim`, kit-88's `--backdrop` with its 4px blur; unchanged here, and tested.
- Shift+click pins inside the viewer's frame keep working (`tsPins`, unchanged).

### 2.8 The `/view/` tab

The standalone viewer (`/view/artifact/<slug>`, `/view/preview/<name>`, `VIEWER` set) hides `.app`, so today it reaches its threads only through the dock. Without the dock it needs the panel and the button, or it loses its list. So in the `/view/` tab: `.threads` and `#tt-peek` (both outside `.app`) show; `#tt-peek` sits at the window's top right as in the dashboard and opens the panel; the viewer's top is `--bar-h` (in place of today's `inset: 0`) so the button has the band above it to itself, as the in-dashboard viewer's top sits at the page bar's height (design, "The artifact viewer and the panel"); and the panel opens beside it as in §2.7. The counts there come from the threads it already polls (`/api/threads`) and the questions it reads from `/api/hello`'s inbox count; it still never reads `/api/data`. My call (the design doesn't name the `/view/` tab); see §6, question 2.

### 2.9 Keyboard

- Escape: with a peek open, closes the peek (kit-88's); else with a floating card or an in-panel thread open, closes it (today's card Escape, now through the route: `t` removed); else with the panel open and the focus in it, closes the panel and returns the focus to the Inbox button.
- The tab bar: the block's roving tabindex and arrow keys. The split button and the rows are buttons. Opening the panel by the button moves the focus to the selected tab; closing it by × returns it to the button.

## 3. Acceptance checks (the done-whens)

Each is a test named in the ticket; the new browser test is `test/dashboard-threads-sidebar.test.mjs` (headless Chrome, skipped where Chrome can't be driven, as the kit's other Chrome tests are). Its fixture is a project (built with `test/lib/kit.mjs`'s helpers) holding: two open questions; four open threads, one ready to accept, one your move with no subject, one waiting on the supervisor, and one your move on a goal (an item subject, pinned on Goals); and two resolved threads.

1. **The panel and its button.** The panel opens from `.pagebar .tt` on Threads (`#…?th=open`), and `#overview?th=inbox` still opens the Inbox page (kit-87's redirect, until kit-100). Opening it pushes the page left by `--threads-w`: at 1440x900 `.main`'s right margin is `--threads-w` (380px) and `.main`'s right edge moves left by that much (±1px). While it is open, `.tt` and `#tt-peek` are hidden (`visibility`), and `#th-close` closes it. `.threads-head` is `--bar-h` tall and its bottom edge is level (±1px) with `.pagebar`'s. `#th-tabs` holds Threads (selected, with the split button below in the pane: Open and Resolved, `aria-pressed`, with counts 4 and 2) and two `aria-disabled` tabs, Supervisor and Shell, and `threadsTabs.list()` returns those three in that order.
2. **Opening threads.** Clicking the subjectless thread's row shows it in the pane (its turns, its composer) with `[data-tl-back]`, which returns to the list; the floating card is hidden. A Shift+click on a goal's card on Goals starts a draft beside the goal; sending words makes a thread that is listed with its pin's number and "Goals"; its card floats beside its pin, clear of the panel. From another page, clicking that row goes to Goals, scrolls the goal into view and opens its card beside the pin. A thread whose subject is an item no longer drawn opens in the pane.
3. **The counts and the marks.** With the fixture, the button reads "Inbox", the red count 2, and the thread count 3 in green (`.n.th.ok`: the one ready plus the two your-move threads, the goal's floating one included); with the ready thread accepted, the count turns blue and counts the your-move threads; with those answered, grey and counts the open threads; with none open, no thread count. The Threads tab shows the your-move number in blue. Each open row has exactly one mark: a filled blue dot and a bold headline (your move), a hollow grey dot (waiting), or a green check (ready), each with a non-empty `title` and `aria-label`; no row has an explanatory line. `#tl-pill`, `#tl-panel` and `#tl-dock` are gone from the page.
4. **With the viewer.** With an artifact open in the viewer, `#tt-peek` shows at the window's top right above the viewer (the element at its centre point is the button), the viewer has no Inbox button, and clicking it opens the panel above the viewer (the element at a point in the panel is in the panel); `#scrim`'s background is `--backdrop`; at 1440x900 the `.shell` element's computed `--av-right` is `calc(var(--threads-w) + 16px)` (resolved: 396px) while the panel is open and unset when it closes; at 720x800 the panel overlays (its left edge is 0). With a peek open and the panel open at 1440x900, the drawer's right edge equals the panel's left edge (±1px), the element at a point inside the panel is the panel (the scrim doesn't cover it), and the bottom edges of `.drawer-head`, `.pagebar` and `.threads-head` are level (±1px).
5. `test/dashboard.test.mjs`'s `threads-core` and `threads-layer` vm tests ("the thread layer's rules: …", and the thread server tests) pass unchanged in what they assert about thread data, `/api/threads` and the thread actions; its Chrome tests that drove the dock drive the panel instead.
6. **A peek and a thread over a reload.** With a ticket's peek open over Board and the panel open on the subjectless thread, `history.state.page` is `#board?th=open&t=<id>`; after a reload the peek is open over Board and the panel is open on that thread; closing the peek leaves `#board?th=open&t=<id>`.
7. **Reload and Back.** On Overview with the panel open on a thread (`#overview?th=open&t=<id>`), a reload keeps the panel open on it; a fresh visit to `#goals` (a new tab, same storage) opens with `th=open&t=<id>` written into its hash from `devteam.threads.open`; after opening a thread from the list, Back shows the list (`#…?th=open`, the panel still open).
8. `test/dashboard-measure.test.mjs`: three entries added, each at 1440x900, 720x800 and 390x844 on every check shell.md §9 names (page-top, prose within `--measure`, overflow, uneven, head-end, head-h, header-pad, tab-motion): Overview with the panel open on the list; Overview with the panel open on the subjectless thread; Goals with the goal thread's floating card open. The Inbox button is hidden while the panel is open, so those entries point the measure's `inbox` option at the visible mirror or at nothing, as kit-88's peek entries do; the thread turns are added to `prose`.

## 4. Edge cases

- **No threads at all:** no thread count on the button, Threads' count empty, the list's empty line; the panel still opens.
- **Pending sends:** a turn the owner just sent is on the thread before the server has it (today's overlay); it makes the thread "waiting on the supervisor" at once, so the counts move with the press.
- **A thread resolved while open** (by the owner or elsewhere): it stays shown, with Reopen, until the owner goes back. A resolved thread named by `t` still opens, after a reload too; only an id `/api/threads` doesn't have is dropped. The remembered `t` follows the same rule.
- **A `t` for a thread not yet read** (a cold load before `/api/threads` answers): the panel shows the list's loading state and opens the thread once the read lands; an id the read doesn't have is dropped from the hash by `replaceState`.
- **The 10-second redraw and the threads poll** while typing in the in-panel composer: the card is moved, never rebuilt, so the focus, caret and words stay (today's `tlCard` rule; the draft store keeps them across a reload).
- **Shift+click inside the panel**: the panel is outside `<main>` and outside `#tl`, so the layer finds no subject there, as for the drawer today; the panel is not a thread target.
- **Pin mode** with the panel open: pointing at the page works as today; the panel and the button are not targets.
- **Narrow screens:** below 900px the panel is the full width; closing it is the ×; the floating card is a bottom sheet under 640px; the button is at the window's top right.
- **Reduced motion:** `--dur` is 0, so the panel and the in-panel view change with no motion; the in-panel view swap uses no animation of its own (the mock's sideways slide is left out: the block names only the panel and peek slides).
- **A `#talk/` link while the panel is open** to a subject thread: the panel stays open (its `th` is kept on the page head), the card opens beside its subject.
- **kit-145** (artifact-annotations' "to check" badge on today's dock row): not landed when this was written. Whichever of the two lands second carries the badge into the new row (ticket note); if kit-145 has landed when this builds, the row gets it here.

## 5. Out of scope

- The Inbox tab in the panel, the nav's Inbox item and the end of the `th=inbox` redirects (`kit-100`).
- The Supervisor and Shell tabs' contents (the follow-on goal).
- The viewer's own inset and narrowing by `--av-right`, and its bar (`kit-141`, `kit-92`).
- One thread per subject beyond what exists today (`kit-97`).
- Any change to `threads-core`'s functions, `/api/threads`, the thread actions, the log or `devteam.mjs`; any change to either shared block; `hub.html` and its operator dock.

## 6. Questions for the supervisor

1. **A file outside touches.** `test/pane-question.answer.test.mjs` (not in touches) clicks `#tl-pill` and reads `#ask-dock` (its lines ~242–245) to check the terminal's question shows "in the dock too, where the owner was talking". Both go (§2.6). Recommendation: add it to touches; its check moves to the panel (`.tt` opens Threads, `#ask-threads` holds the card). Sent as a design-change message.
2. **The `/view/` tab** (§2.8): the design doesn't name it; without the dock it would lose its thread list. Recommendation: the floating Inbox button and the panel there too, with the viewer's top at `--bar-h`, as above. The alternative is to leave `/view/` with pins and cards only and no list, which drops something today's page has.

## 7. Rulings

- `m-20261115-203750802-supervisor`: plan ahead; spec and plan now; build only after kit-88 has merged and approve-plan is recorded. Briefs carry lessons `k-20261115-182656232`, `k-20261115-080753394` and `k-20261115-164245020` and the scripts-in-files rule; run only the touched test files, at `--test-concurrency=2`.
