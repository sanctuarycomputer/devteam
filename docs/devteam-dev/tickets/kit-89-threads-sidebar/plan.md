# kit-89 Threads sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- Five tasks in `docs/devteam/dashboard/index.html` (page CSS and JS outside both shared blocks) plus tests; the new Chrome test `test/dashboard-threads-sidebar.test.mjs` grows a subtest per task. Build starts after kit-88 merges and approve-plan; T0 re-reads kit-87/88 as merged first.
- T1 builds the panel (`aside.threads` on `<body>`), its tabs through `threadsTabs`, the Open / Resolved list with three marks from one `tState(t)`, the button's coloured count, `thGo`/`thHead` (every Threads change through the route, `withPage` under a link head), and removes the dock, moving the tests that drove it.
- T2 moves reading into the panel: one `#tl-card` moved into `#th-card-slot` for in-panel threads (`tlInPanel`), floating cards clear of the panel, row clicks as one entry, + drafts, `talk/`, Escape.
- T3 finishes history: bad values dropped, `TH_MADE` telling Threads changes from fresh entries, `devteam.threads.open` remembered and applied in a fixed order.
- T4 is the viewer: `av-open`, the mirror `#tt-peek` above it, the panel above it, `--av-right`, and the `/view/` tab.
- T5 adds three measure entries, sweeps string checks (and `dev-links.mjs`), and writes verification.
- Risk: kit-87's router and kit-88's mirror are built on before seen merged; moving the one card and routing every change through the hash are where focus, history or a dropped test would break, so each has its own test and kit-87/88's own tests run in every task.

**Goal:** Threads becomes a full-height side panel with real tabs, opened from the top-right Inbox button with its counts; threads started on a thing keep floating beside it.

**Architecture:** The route owns the panel: `th`/`t` in the page head in force (the entry's own, or `history.state.page` under a link head) decide what is open, and every control only calls `thGo`. The panel is the shell block's `.threads` frame; the page adds `threads-open` and draws the Threads pane through `threadsTabs`. The thread card stays one element, moved between the floating layer and the panel's card slot only when its place changes.

**Tech Stack:** one HTML page with inline CSS/JS (no build), `node:test`, headless Chrome through `test/lib/chrome.mjs`, `vm` for marker blocks.

**Spec:** `docs/devteam-dev/tickets/kit-89-threads-sidebar/spec.md` (this repo).

## Global Constraints

- Never change the `devteam-layout` or `devteam-shell-js` blocks (shell.md §1); new CSS goes after the block, new JS outside `devteam-shell-js`; `threads-core` and its functions unchanged.
- Files only from the ticket's touches, which include `test/pane-question.answer.test.mjs` (ruling `m-20261115-204940196-supervisor`), kit-87's `test/dashboard-pages.test.mjs` and kit-88's `test/dashboard-peek.test.mjs` (`m-20261115-205924178-supervisor`: keep their assertions, change only navigation), and `test/browser/dev-links.mjs` (`m-20261115-210541487-supervisor`: one navigation line).
- Every test run: `timeout 900 node --test --test-concurrency=2 <file>`, one file at a time, judged by its own exit code, never through a pipe; never the full suite on the box (CI is the gate). Every task runs these five: the new file, `test/dashboard.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/pane-question.answer.test.mjs`.
- Probes: under `timeout`, never fed from `/dev/zero`, nothing in the background; kit commands outside tests with their own `HOME`, `DEVTEAM_HUB_PORT` away from 4320, `DEVTEAM_*` unset (lessons k-20261115-182656232, k-20261115-080753394, k-20261115-164245020).
- Thread data, `/api/threads` and the thread actions unchanged; no `devteam.mjs` or schema change.
- Tokens by name: `--threads-w` (380px; 100vw below 900px), `--bar-h` (49px), `--panel-pad`, `--header-pad`, `--backdrop`, `--line-2`; `--av-right: calc(var(--threads-w) + 16px)` only above 900px while open.
- Words exactly: "Inbox"; tabs "Threads", "Supervisor", "Shell" (titles "The supervisor's terminal: the follow-on goal", "A plain shell at the repo root: the follow-on goal"); split "Open", "Resolved"; marks "Ready to accept", "Your move", "Waiting on the supervisor"; button titles "N ready to accept, M your move" / "M your move" / "N waiting on the supervisor"; empty lines "No open threads. Hold Shift and click anything on the page, or start one with +." and "Nothing resolved yet."; back arrow `aria-label="Back to the threads"`; × `aria-label="Close Threads"`.
- Test isolation: each Chrome test starts its own project on its own port, so its `localStorage` (origin) is its own; within the new file, a subtest that opens the panel closes it (or clears `devteam.threads.open`) before it ends.

## Review Focus

1. A redraw (10 s render, 2 s card poll) while the owner types in the in-panel composer must not drop focus, caret or words: T2.
2. Back/Forward through Threads changes under a peek must neither stack entries nor lose `th`/`t`: T3 counts `history.length` across a change under a peek (unchanged) and reads `history.state.page`.
3. A `t` for an unknown thread (from a stale remembered store) opens the list, not a blank pane: T3 sets `devteam.threads.open` to `{th:'open', t:'t-nope'}` and expects the list, `t` dropped from the hash.
4. The count follows the pending overlay at once: in T1's own counts fixture, a reply sent through the composer on a your-move thread, with `/api/threads` held by `POLL_FAST`'s existing hold (`window.__threadsHold` / `__threadsLet`, copied with the helpers), changes the count before the read lands.
5. Narrow screens: at 390x844 the panel covers the page, × reachable, no horizontal scroll: T1.

---

### Task 0: Re-read against main (no code)

- [ ] When kit-88 has merged and approve-plan is recorded: `git merge origin/main`; read kit-87's and kit-88's merged code for the names this plan uses: `route()`, the `talk/` rewrite, `SHELL_ROUTES.redirects` `th=inbox` entries, kit-87's freshness check, `#tt-peek` and its observer, `overlay-open`, `openArtifact`/`closeArtifact`/preview close, `tlGoTo`, the measure entries' shape; and list every dock read (`tl-pill`, `tl-list`, `tl-dock`, `ask-dock`, `tl-resolved`) in merged `test/dashboard-pages.test.mjs` and `test/dashboard-peek.test.mjs` for T1 to move. Where a name differs, edit this plan ("kit-89: plan names as merged"); where behaviour differs from the spec's quotes, `send supervisor … --kind design-change` before building.
- [ ] `devteam.mjs phase build --task T1`.

**As merged (T0, at 872d503; main with kit-87, kit-88, kit-241):** these names replace the plan's where they differ.
- `.tt` is `button.ghost.tt#inbox-btn` in `header.pagebar` (red count `#inbox-btn-n.n.q`); its click is `$('inbox-btn').addEventListener('click', () => { location.hash = '#inbox'; })` (~1435), which T1 replaces with `thGo({ th: 'open', focus: true })`. The Inbox page stays reachable from the nav.
- Router: `route()` (~5093) calls `stampEntry()` first; there is no freshness flag. "Fresh" (spec §2.5) is read in `route()` before `stampEntry()`: `const fresh = !history.state || typeof history.state.page !== 'string'`. `goHead(head, { replace })` (~5075) is the page-head path: `thGo` uses `goHead(head)` for a new entry and `goHead(head, { replace: true })` for stamped `replaceState`. `HERE` is the stamp on screen; `history.state.page` the page head under a link.
- `th=inbox` redirects: `SHELL_ROUTES.redirects` `<page>?th=inbox → inbox` (~1394) and the multi-key rewrite in `route()` (~5127), kept.
- `talk/<id>`: a link head; `tlRoute(id)` (~6111) does `history.replaceState(withPage(history.state, subjectHead(t.subject)), '')` and opens the card; `tlLeave()` (~6130) closes it on leaving. T2's in-panel `talk/` sets that page head with `th=open&t=<id>` there.
- `tlGoTo(s)` (~6043) computes a subject's page head (`subjectHead`), as T2's floating rows use.
- `#tt-peek` (~1059, CSS ~623–627): kit-88 places it left of the peek (`right: calc(min(720px, 100vw) + var(--header-pad))`, z 22), shown under `.shell.peek-open:not(.threads-open)`, hidden at ≤840px; a MutationObserver (~1440) already copies `.tt`'s content, `aria-label` and `title`, and its click is `.tt`'s. T4 adds the viewer placement after these rules.
- `overlay-open` on `<body>` (set ~2643, ~4996, ~5016; cleared ~2692, ~5030) is the viewer's/preview's/review's scrim class; T4's `av-open` is set beside it in `openArtifact` (~5000) and `openPreview`, cleared in `closeArtifact` (~5020) and the preview close.
- Dock reads to move in T1 (line numbers as merged): `test/dashboard.test.mjs` ~542, ~1920, ~2586, ~2600, ~2616, ~3367–3452, ~3586, ~3674–3682, ~3712; `test/dashboard-pages.test.mjs` ~447–449 (kit-87 AC8: the dock lists a thread, then opens it) and ~945–948 (a settings thread's row reads `.tl-r .small` = "Settings, <name>": the row's meta in the panel, assertion kept); `test/pane-question.answer.test.mjs` ~274–277 (kit-241 moved it); `test/browser/dev-links.mjs` ~559–560. `test/dashboard-peek.test.mjs`: no dock read.

### Task 1: The panel, its list and counts, `thGo`; the dock goes

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (markup after `#tl`, dock markup and CSS removed; page CSS after the block; JS in `threads-layer` and the router; `render()` draft keeping; `holding()`)
- Modify: `test/dashboard.test.mjs` (dock-driving lines ~536, ~1881, ~2534–2541, ~3334–3375, ~3597–3605), `test/pane-question.answer.test.mjs` (~242–245), `test/dashboard-pages.test.mjs` (kit-87 AC 1a: `.tt` opens `#…?th=open`)
- Create: `test/dashboard-threads-sidebar.test.mjs`

**Interfaces:**
- Produces: `tlOwn(el)` = `closest('#tl, #threads')`; `holding()` and `render()`'s draft-keeping skip `#tl, #threads`; `tlHitAt` → null when the topmost element at the point is in `#threads`; `tState(t) → 'ready'|'you'|'wait'`; `tCounts(threads) → { open, you, ready, wait }`; `tButton(c) → { cls: 'ok'|'you'|'wait'|null, n, title, label }`; `thHead() → string` (the page head in force); `thGo({ th, t })` (under a link head `history.replaceState(withPage(history.state, head), '', location.href)` then redraw the panel, the link left open; else `location.hash = head`); `thDraw()` (button, tabs, pane; from `tlDraw()` and after `render()`); `TH = { th, t }` set by the router from `thHead()`; DOM: `#threads` > `.threads-head` (`#th-tabs`, `.end` with `#tl-pinbtn`, `[data-tl-new]`, `#th-close`) + `#th-body` > `#th-pane` (`#ask-threads`, `[data-thf]`, `ul.thread-list#tl-list` of `li > button.th-row[data-tl-open]`) + `#th-card-slot.no-shell`; `.th-st.ok|.you|.wait`; `.tt .n.th.<cls>`.
- Consumes: block `threadsTabs`, `tabBar`, `bindTabBar`, `withPage`; kit-87's `route()`.

- [ ] **Step 1: Write the failing test.** Fixture on `threadsFixture('threads-sidebar')` (copy `goalArgs`' list; it isn't exported): one open question by `F.sup(['ask', …])` and a second asked in `A` (below), so two open; goal `G2` (priority 2) with no thread; threads by CLI: `A` subjectless, owner then `thread reply`, then `thread ask <A> --question "Which colour?" …` (your move, holds a question); `B` owner only (waiting); `C` owner, reply, `thread ready --outcome "done"` (ready); `G` subject `{"kind":"item","ref":"goal:<F.goal>"}`, reply (your move); `X` owner only, subject `{"kind":"item","ref":"ticket:kit-gone"}` (waiting; no element); two resolved. Helpers copied in shape from `dashboard.test.mjs` (`soonIn`, `POLL_FAST`). Subtest "the panel and its button" at 1440x900 on `#overview`:
  - `.tt` starts "Inbox", red count 2, `.n.th.ok` 3, `title` "1 ready to accept, 2 your move", `aria-label` contains "2 open questions";
  - `.main`'s right edge, closed vs open, differs by 380 ±1; click `.tt` → hash `#overview?th=open`, `threads-open` on `<body>`, `.main` right margin `380px`, `.tt` and `#tt-peek` `visibility: hidden`;
  - `.threads-head` 49 tall, its bottom within 1px of `.pagebar`'s;
  - `threadsTabs.list().map(t => [t.id, t.disabled])` = `[['threads',false],['supervisor',true],['shell',true]]`; drawn tabs: Supervisor and Shell `aria-disabled="true"` with the titles above; Threads `.n.blue` 2;
  - `[data-thf="open"]` "Open 5", `aria-pressed="true"`; `[data-thf="resolved"]` "Resolved 2";
  - five rows: `A` `.th-st.you` (`title` and `aria-label` "Your move"), headline `font-weight >= 600`; `B` `.th-st.wait`; `C` `.th-st.ok`; `G` `.pinchip` = its pin number and "Goals"; `X` " · subject gone"; no row has a third line;
  - `[data-thf="resolved"]` click → two resolved rows and the focus on that button;
  - `#th-close` → `#overview`, closed, `.tt` visible; `#overview?th=inbox` loads the Inbox page;
  - `#tl-pill`, `#tl-panel`, `#tl-dock`, `#ask-dock` absent;
  - at 720x800 with the panel open, Shift held and the pointer moved over the panel: `#tl-cursor` hidden;
  - at 390x844: `.threads` rect = the viewport, `#th-close` inside it, `scrollWidth <= innerWidth`;
  - focus on the Threads tab, then a CLI `thread reply` changes its count: the focus stays on that tab.
  Subtest "the counts as threads move" on its own `threadsFixture('threads-counts')` (one ready `C2`, two your-move `Y1`, `Y2`, one waiting `W`): Review Focus 4 on `Y1` (green 3 → green 2 before the held read lands); `thread resolve <C2> --accept` → `.n.th.you` 1; `thread say <Y2>` → `.n.th.wait` 3 (open threads) and the Threads tab with no number; resolve every open thread → no `.n.th`.
- [ ] **Step 2:** run the new file → FAIL (no `#threads`).
- [ ] **Step 3: Implement** spec §2.1–§2.3, §2.6 and `thGo`/`thHead` as above: markup a child of `<body>` after `#tl`; tabs registered once, titles set after each draw, Threads' `count()` null at 0; `.tt` → `thGo({ th: 'open' })`, `#th-close` → `thGo({})`, `[data-thf]` → `thGo({ th })`; rows → `tlOpen` for now (T2 routes them); `#th-tabs` redrawn only when its HTML changed and no tab is focused or pressed; `askDraw()` targets `ask-inbox`, `ask-threads`, `tl-c-ask`; the dock's markup, CSS, `tlDock`, `#tl-pill` handling removed (a subjectless card keeps its `in-dock` corner placement until T2); page CSS for `.th-st`, `.th-row` (the mock's `.titem` grid), `.pinchip`, and `:where(.shell).threads-open .pagebar .tt, :where(.shell).threads-open #tt-peek { visibility: hidden }`; a change of view (route) draws pane and tabs at once and places the focus (spec §2.1 Redraws); a refresh writes the button and pane only when their HTML changed and `!tlHeld`; `#ask-threads` shown with the list only.
- [ ] **Step 4:** migrate the dock tests: pill count/dot → `.tt .n.th` and row marks; `#tl-pill` clicks → `.tt`; `#tl-list [data-tl-open]` stays; `.tl-resolved` → `[data-thf="resolved"]` then the row; `#tl-pinbtn`/`[data-tl-new]` now in the panel head (open the panel first); viewer ~1881 → `!document.getElementById('tl-pill') && !!document.getElementById('threads')` (T4 adds `#tt-peek` shown). `pane-question.answer.test.mjs` 242–245: the `#tl-pill` text match is replaced by opening `.tt` and `soon('#ask-threads [data-ask-option]')`, the card's assertion kept, then `#th-close`. `dashboard-pages.test.mjs`: AC 1a's `.tt` click lands on `#<page>?th=open`, and every other read of the dock (its AC8 included; T0 lists them as merged) moves to the panel (`.tt` then `#tl-list`), assertions kept. `dashboard.test.mjs` ~2534 (panel with the viewer up): until T4 places `#tt-peek`, close the viewer first, then `.tt`; T4 restores the viewer-up path through `#tt-peek`. Closing clicks while the panel is open use `#th-close` (`.tt` is hidden then). The five files → each PASS.
- [ ] **Step 5:** commit "kit-89: T1 the panel, its list and counts; the dock goes"; `reviews/task-1.md`.

### Task 2: Reading threads in the panel and beside their subject

**Files:** Modify `docs/devteam/dashboard/index.html` (`tlCard`, `tlPlaceCard`, `tlClose`, `tlOpen`, the click handler, `tlSend`'s new-thread path, the Escape handler); Modify `test/dashboard.test.mjs` (~3338: a + draft is now in-panel, so its `in-dock` check becomes `#th-card-slot #tl-card.in-panel`, the rest kept); Test the new file.

**Interfaces:**
- Consumes: T1's `TH`, `thGo`, `thHead`, `thDraw`, `tState`.
- Produces: `tlInPanel(t) → boolean` (spec §2.4: no subject; item with `tlHome` null; page subject whose section doesn't exist; in `/view/`, a subject not this stage's — T4 adds that branch); `#tl-card.in-panel` in `#th-card-slot`, moved only when its place changes, `.tl-head` hidden, no `role`; `[data-tl-back]` in `#th-pane`.

- [ ] **Step 1: Failing subtest** "opening threads" (after "the panel and its button"):
  - `A`'s row → hash `…?th=open&t=<A>`, `#th-card-slot #tl-card.in-panel` with `A`'s turns and `#tl-c-text`, `#tl-c-title` and `[data-tl-close]` hidden, Resolve visible in `#tl-c-acts`, no `role`; the focus on `[data-tl-back]`; `#ask-threads` hidden; `[data-tl-back]` → `…?th=open`, list shown, the focus on `A`'s row;
  - Review Focus 1: type in `#tl-c-text`, wait 11 s (past one 10-second render) and until `window.__threadsRead` is set again (a threads poll); value, `selectionStart` and `document.activeElement` kept;
  - `A`'s question card in the panel: type in its `textarea[data-q]`, wait a redraw; the Inbox page's copy (`#inbox textarea[data-q]`) unchanged and the panel's kept;
  - `X`'s row opens it in the pane;
  - on `#goals`, Shift+click `G2`'s card (as `dashboard.test.mjs` does) → floating draft beside it; send "hello" → listed with its pin number; with the panel open, the card's right edge ≤ `innerWidth − 380`;
  - from `#overview?th=open`, `G`'s row → `#goals?th=open&t=<G>`, `history.length` +1, goal card in view, `#tl-card` floating, row `aria-current="true"`; Back → `#overview?th=open`;
  - at 720x800 from `#overview?th=open`, `G`'s row → `#goals?t=<G>` (panel closed, card shown);
  - `+` → in-panel draft focused, hash unchanged; Send "new one", then at once type "second" in `#tl-c-text` → when the hash gains `t=<id>` (a new entry) the focus is still in `#tl-c-text` and its value is "second"; pressing Resolve in its `#tl-c-acts` resolves it (`[data-thf="resolved"]` count up by one); Back → the list;
  - the in-panel card's close: `[data-tl-back]` (its `.tl-head` with `[data-tl-close]` is hidden), so `dashboard.test.mjs` ~3346 and ~3509 (subjectless threads) use `[data-tl-back]`;
  - after `G`'s row is clicked (it floats), the focus is on `G`'s row (`aria-current`);
  - at 720x800 with the panel open, Pin closes the panel and starts pin mode;
  - a `#talk/<A>` link clicked on Board → the panel open on `A`, `history.state.page` = `#board?th=open&t=<A>`;
  - a floating card with no box on screen (`G`'s card opened by `#goals?t=<G>` then its goal's `<details>` closed, or `#overview?t=<G>`): `#tl-card.in-dock` at the bottom right, its right edge ≤ `innerWidth − 380 − 16` with the panel open; `.tl-card.in-dock` `bottom` 16px; at 720x800 with the panel open, the card hidden;
  - Escape with the focus on the panel list while `G`'s card floats → the panel closes, the card stays; Escape in an in-panel thread → the list, focus on its row; in pin mode with the focus in the panel, Escape ends pin mode first, the panel stays open.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** spec §2.4, §2.9 (the parts without a peek): `tlCard()` moves the card only when `tlInPanel` (or a panel draft) differs from where it is; `.tl-card.in-panel` page rule (static, slot width, no frame, no max-height, `#tl-c-title` and `[data-tl-close]` hidden, `#tl-c-acts` shown); the `pending-N` draft's words carried to the real id; a focus removed by a pane draw goes to the current row, else the selected tab; at ≤900px Pin closes the panel first; `tlPlaceCard` passes `innerWidth − (open && innerWidth > 900 ? 380 : 0)` to `tPlace` (380 the `--threads-w` value above 900px; `#threads`' own `getBoundingClientRect().width` may be read instead); `.tl-card.in-dock` is kept for a floating card with no box on screen, its `right` `calc(var(--threads-w) + 16px)` while the panel is open above 900px (spec §2.6); in-panel rows → `thGo({ th, t })`; floating rows → one `location.hash` of the subject's page head (as `tlGoTo` computes it) with `t` and, above 900px, `th`, then scroll and open as `tlGoTo` does; the + draft in `TL.draft` with no URL change, and once `/api/threads` has its id, `thGo({ th, t: id })` with the focus left where it is (no focus placement for this change); `thGo` takes a `focus` flag, set only by clicks and keys in the panel or on the Inbox button; each pane draw calls `askDraw()`; `.tl-panel .ask` sizing moved to `#ask-threads .ask`; at ≤900px with the panel open, floating cards hidden; `talk/` to an in-panel thread rewrites through kit-87's `withPage` path to `th=open&t=<id>`; the Escape handler: focus in `#threads` → back or close panel; the card's Escape narrowed from `tlOwn` to `#tl`.
- [ ] **Step 4:** the five files → each PASS.
- [ ] **Step 5:** commit "kit-89: T2 threads read in the panel and beside their subject"; `reviews/task-2.md`.

### Task 3: History, peeks, reload and the remembered panel

**Files:** Modify `docs/devteam/dashboard/index.html` (router, `thGo`); Test the new file.

**Interfaces:** Produces `TH_MADE` (the head `thGo` is about to assign), `THREADS_KEY = 'devteam.threads.open'`, the route order (apply store on fresh → draw → write store), `thFocusBack()` (focus to the visible Inbox button, else the peek's or viewer's close).

- [ ] **Step 1: Failing subtests** "a peek and a thread over a reload" (spec AC6), "reload and Back" (spec AC7, its × and nav-click cases included), Review Focus 2 and 3, and:
  - with a ticket's peek open over Board and the panel open, `G`'s row closes the peek and lands on `#goals…t=<G>` with the card open;
  - with a peek open and the focus in the in-panel composer, Escape closes the in-panel thread, not the peek; Escape on the list closes the panel and the focus is on `#tt-peek`;
  - opening a peek keeps `devteam.threads.open`; with a floating card open and the panel open, a nav click carries `th=open` only;
  - `#overview?th=bogus&t=BAD!` → `#overview`, closed; `#overview?t=<A>` → `th=open` added, `A` in the panel;
  - closing a floating card (×) → a new entry without `t`; Back reopens it; Back after the back arrow reopens the thread; a resolved thread's `t` survives a reload, and clicking Reopen in the in-panel card reopens it;
  - under a `#talk/<G>` card with the panel open, opening `A` from the list replaces the `talk/` entry (`history.length` unchanged) with `…th=open&t=<A>`; under a `#talk/<A>` card (in the panel), the back arrow replaces the `talk/` entry with `…th=open` (`history.length` unchanged);
  - a fresh tab on `#goals` with `devteam.threads.open` = `{th:'open', t:<A>}` and `/api/threads` held 3 s (the hold set by an init script of its own in that tab, since `POLL_FAST`'s runs only in the first): the hash keeps `t=<A>` while held and `devteam.threads.open` is unchanged, and `A` opens in the panel when the read lands;
  - opening by `.tt` focuses the selected tab; × returns the focus to `.tt`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** spec §2.5 and §2.9's peek cases: `thGo` sets `TH_MADE`; the router treats a stateless entry equal to `TH_MADE` as a Threads change; route order as above; only an in-panel `t` stored with `th`; `t` without `th` for an in-panel thread → `th=open` by stamped `replaceState`; decisions needing the threads (known, in-panel, stored, `th` added, dropped) wait for the first `/api/threads` read and when it lands only the Threads part of the route re-runs (decisions, panel draw, store; no peek reopened, no scroll); on a fresh link head the store goes into `history.state.page` by `withPage`; under `talk/`, any change of `t` (including dropping it) replaces the entry; bad values checked after `parseHead` (in the router) and dropped by stamped `replaceState`; under `talk/`, a change of `t` replaces the entry with the page head plus `th`, `t`.
- [ ] **Step 4:** the five files → each PASS.
- [ ] **Step 5:** commit "kit-89: T3 Threads in history, under a peek and remembered"; `reviews/task-3.md`.

### Task 4: With the artifact viewer, and the `/view/` tab

**Files:** Modify `docs/devteam/dashboard/index.html` (`openArtifact`, `openPreview`, their closes, `#tt-peek`'s observer, page CSS, `viewerBoot`, `tlInPanel`'s `/view/` branch); Modify `test/dashboard.test.mjs` (viewer ~1878–1881), `test/dashboard-peek.test.mjs` (only lines this placement or the copied attributes move, assertions kept); Test the new file.

**Interfaces:** Produces `av-open` on `<body>` while `#artifact-view` shows in the dashboard; `--av-right` on `.shell.threads-open` above 900px; in `/view/`, `thGo` sets `TH` and toggles `threads-open` on `<body>` (no router), `thDraw()` writes `#tt-peek` from `TL.threads` and hello's `inbox`.

- [ ] **Step 1: Failing subtest** "with the viewer" — spec AC4 in full: `#tt-peek` is `elementFromPoint`'s hit at its centre above the viewer; no `.tt` or `[data-inbox]` inside `#artifact-view`; pressing it opens the panel above the viewer with `#artifact/…` still the hash and the viewer open; `#scrim`'s background equals `--backdrop`; a probe `position:fixed; width: var(--av-right, 0px)` on `<body>` is 396px at 1440 while open, 0 after close; panel left 0 at 720x800; with a peek and the panel at 1440: drawer right = panel left ±1, `elementFromPoint` inside the panel in `#threads`, the three bars' bottoms level ±1; viewer over a peek: `#tt-peek` at the top right; 720x800 with the viewer up: `#tt-peek` hidden and `#av-close` is the hit at its centre; with a peek open, `#tt-peek`'s `aria-label`/`title` equal `.tt`'s. Subtest "the /view/ tab" (spec AC9): at `/view/artifact/<slug>`, `#tt-peek` at the top right with the thread count at 1440 and at 720, `#artifact-view` top 49, click opens `#threads` with the list, `A`'s row in the pane, `G`'s row in the pane too (a dashboard item there), × closes, `/api/data` never asked.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** spec §2.7–§2.8: `av-open` toggled in the open/close functions (never in `/view/`); `#tt-peek` placed top right under `.shell.av-open:not(.threads-open)` (also with `peek-open`, written after kit-88's rule) and under `.viewer`, z 24; hidden at ≤900px under `av-open` only; `.threads` z 23 under `av-open` and `.viewer`; the observer copies `aria-label` and `title`; `@media (min-width: 901px) { :where(.shell).threads-open { --av-right: calc(var(--threads-w) + 16px) } }`; `.viewer #artifact-view:not([hidden]) { inset: var(--bar-h) 0 0 }`; `/view/` branch of `thGo`, `thDraw`, `tlInPanel`; hello's `inbox` kept from its 30 s poll.
- [ ] **Step 4:** update `dashboard.test.mjs` viewer assertions (rect top 49, `#tt-peek` shown) and `dashboard-peek.test.mjs` as above; the five files → each PASS.
- [ ] **Step 5:** commit "kit-89: T4 the panel beside the viewer, and in the /view/ tab"; `reviews/task-4.md`.

### Task 5: The measure, the string sweep, verification

**Files:** Modify `test/dashboard-measure.test.mjs`, `test/browser/dev-links.mjs` (~559, ~560); any of `test/gateway.test.mjs`, `test/multirepo-views.test.mjs`, `test/ooda-learning.test.mjs`, `test/ooda-lineage.test.mjs`, `test/plain-questions.test.mjs`, `test/fleet-park.test.mjs`, `test/multirepo-landing.test.mjs`, `test/lib/kit.mjs`, `test/lib/chain.mjs` only where a string check reads markup this ticket changed; create `docs/devteam-dev/tickets/kit-89-threads-sidebar/verification.md`.

- [ ] **Step 1:** add three `PAGES` entries on a second project seeded like T1's fixture (as kit-88 did, so earlier entries keep their data): `#overview?th=open`, `#overview?th=open&t=<A>`, `#goals?t=<G>`; each `ready` waits for the panel or card drawn; `opts.inbox` a selector matching nothing (spec AC8); before each, `localStorage.removeItem('devteam.threads.open')` (a `Page.addScriptToEvaluateOnNewDocument` the entries share), so no entry inherits another's panel.
- [ ] **Step 2:** `devteam.mjs gate test -- timeout 900 node --test --test-concurrency=2 test/dashboard-measure.test.mjs` → fix failures in page CSS (never the measure) until PASS.
- [ ] **Step 3:** `grep -n -E "tl-pill|tl-panel|tl-dock|ask-dock|tl-resolved|tl-row"` in each touched test file; update hits; run each changed file → PASS. `dev-links.mjs`: `#tl-pill` click → `.tt`; `.tl-resolved [data-tl-open]` → `[data-thf="resolved"]` then the row (hand-run, not CI; said in verification).
- [ ] **Step 4:** merge `origin/main`, push; CI through `gate ci` with the real watch command, its conclusion green at the head; `verification.md` one row per done-when with command, result and commit.
- [ ] **Step 5:** commit "kit-89: T5 measure entries, sweep, verification"; `reviews/task-5.md`; then worker.md §8.

## Self-review notes

Spec coverage: §2.1–2.3, 2.6 → T1; §2.4, 2.9 (no peek) → T2; §2.5, 2.9 (peek) → T3; §2.7–2.8 → T4; AC8 → T5; AC5 → every task's `dashboard.test.mjs` run. kit-145's badge goes into the row in T1 only if kit-145 has merged by then.

## Rulings

- `m-20261115-203750802-supervisor`: plan ahead; build after kit-88 merges and approve-plan.
- `m-20261115-204940196-supervisor`: `test/pane-question.answer.test.mjs` in touches, its dock check moved to the panel with its assertion kept; the `/view/` tab gets the floating Inbox button and the panel (spec §2.8).
- `m-20261115-205924178-supervisor`: Q3 yes (kit-84's rule for your move), Q4 yes (a row goes to its subject's page; an open peek closes), Q5: `test/dashboard-pages.test.mjs` and `test/dashboard-peek.test.mjs` in touches; keep their assertions, change only navigation.
- `m-20261115-210541487-supervisor`: `test/browser/dev-links.mjs` in touches, for its one navigation line.
