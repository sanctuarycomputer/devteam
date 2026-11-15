# kit-89 Threads sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- Five tasks, all in `docs/devteam/dashboard/index.html` (page CSS and JS outside both shared blocks) plus tests; one new Chrome test file, `test/dashboard-threads-sidebar.test.mjs`, grows a subtest per task.
- T1 builds the panel (`aside.threads` on `<body>`), its tabs through `threadsTabs`, the Open / Resolved list with three state marks from one `tState(t)`, and the Inbox button's coloured thread count, opened and closed by the router from `th`.
- T2 moves thread reading into it: the one `#tl-card` reparented into the pane for subjectless threads (back arrow), floating cards kept clear of the panel, row clicks, `talk/` to a subjectless thread; the dock is removed and the tests that drove it move to the panel.
- T3 finishes history: every Threads change a hash entry, `withPage` under a peek, `devteam.threads.open` remembered for fresh entries.
- T4 is the viewer: `av-open`, the mirror `#tt-peek` above it, the panel above it, `--av-right`, and the `/view/` tab.
- T5 adds the three measure entries and sweeps the string checks in the other touched test files, then verification.
- Build starts only after kit-88 merges and approve-plan is recorded; T0 re-reads kit-87/88 as merged and adjusts names here before any code.
- Risk: kit-87's router and kit-88's mirror are built on, not yet seen merged; reparenting the one card and routing every Threads change through the hash are where focus, history or a dropped test would break, so each has its own test (T2, T3) and kit-87/88's own tests run in every task.

**Goal:** Threads becomes a full-height side panel with real tabs, opened from the top-right Inbox button with its counts; threads started on a thing keep floating beside it.

**Architecture:** The route owns the panel: `th`/`t` in the page head (or in `history.state.page` under a peek) decide what is open, and every click only assigns a hash. The panel is the shell block's `.threads` frame; the page adds `threads-open` and draws the Threads pane through `threadsTabs`. The thread card stays one element, moved between the floating layer and the pane.

**Tech Stack:** one HTML page with inline CSS/JS (no build), `node:test`, headless Chrome through `test/lib/chrome.mjs`, `vm` for marker blocks.

**Spec:** `docs/devteam-dev/tickets/kit-89-threads-sidebar/spec.md` (this repo).

## Global Constraints

- Never change the `devteam-layout` or `devteam-shell-js` blocks (shell.md §1); new CSS goes after the block, new JS outside `devteam-shell-js`, `threads-core` and its functions unchanged.
- Files only from the ticket's touches, which include `test/pane-question.answer.test.mjs` (ruling `m-20261115-204940196-supervisor`) and kit-87's `test/dashboard-pages.test.mjs` and kit-88's `test/dashboard-peek.test.mjs` (ruling `m-20261115-205924178-supervisor`: keep their assertions, change only navigation).
- Every test run in every task: `timeout 900 node --test --test-concurrency=2 <file>`, one file at a time, judged by its own exit code. Each task runs the new file, `test/dashboard.test.mjs`, `test/dashboard-pages.test.mjs` and `test/dashboard-peek.test.mjs`.
- Thread data, `/api/threads` and the thread actions unchanged; no `devteam.mjs` or schema change.
- Tokens used by name: `--threads-w` (380px; 100vw below 900px), `--bar-h` (49px), `--panel-pad`, `--header-pad`, `--backdrop`, `--line-2`; `--av-right: calc(var(--threads-w) + 16px)` only above 900px while open.
- Words exactly: "Inbox"; tabs "Threads", "Supervisor", "Shell"; split "Open", "Resolved"; marks "Ready to accept", "Your move", "Waiting on the supervisor"; button titles "N ready to accept, M your move" / "M your move" / "N waiting on the supervisor"; empty lines "No open threads. Hold Shift and click anything on the page, or start one with +." and "Nothing resolved yet."; back arrow `aria-label="Back to the threads"`; × `aria-label="Close Threads"`.
- Tests: run only the touched files, one at a time, `node --test --test-concurrency=2 <file>`; never the full suite on the box; gates through `devteam.mjs gate`. Every probe under `timeout`, never fed from `/dev/zero`, no background processes; kit commands outside tests with their own `HOME`, `DEVTEAM_HUB_PORT` away from 4320, `DEVTEAM_*` unset (lessons k-20261115-182656232, k-20261115-080753394). Judge a run by its own exit code, never through a pipe (k-20261115-164245020).

## Review Focus

1. A redraw (10 s render, 2 s card poll) while the owner types in the in-panel composer must not drop focus, caret or words: T2 test types, waits for two polls, asserts value and `document.activeElement`.
2. Back/Forward through Threads changes with a peek open must neither stack entries nor lose `th`/`t`: T3 test counts `history.length` across a change under a peek (unchanged) and asserts `history.state.page`.
3. A `t` for an unknown thread (deleted, from another project's remembered store) must open the list, not a blank pane: T3 test sets `devteam.threads.open` to `{th:'open', t:'t-nope'}` and expects the list with `t` dropped from the hash.
4. The thread count's colour must follow the pending overlay at once (owner sends → that thread becomes "waiting"): T1 test sends a reply on the your-move thread through the composer and expects the count to change before the server's next read lands (stubbed slow `/api/threads`).
5. Narrow screens: at 390x844 the panel covers the page fully, × reachable, no horizontal scroll: T1 test checks `.threads` rect equals the viewport and `scrollWidth <= innerWidth`.

---

### Task 0: Re-read against main (no code)

- [ ] When kit-88 has merged and approve-plan is recorded: `git merge origin/main`; read kit-87's and kit-88's merged code for the names this plan uses: `route()`, the `talk/` rewrite, `SHELL_ROUTES.redirects` `th=inbox` entries, `#tt-peek`, `overlay-open`, `openArtifact`/`closeArtifact`/preview close, `tlGoTo`, the measure entries' shape in `test/dashboard-measure.test.mjs`. Where a name differs, edit this plan's names (a commit "kit-89: plan names as merged"); where behaviour differs from the spec's quotes, `send supervisor … --kind design-change` before building.
- [ ] `devteam.mjs phase build --task T1`.

### Task 1: The panel, its tabs, the list and the button's counts

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (markup after `#tl`; page CSS after the dock rules; JS in `threads-layer` and the router)
- Modify: `test/dashboard-pages.test.mjs` (kit-87's AC 1a: `.tt` opens the panel, `#…?th=open`, in place of `#inbox`; its other assertions kept)
- Create: `test/dashboard-threads-sidebar.test.mjs`

**Interfaces:**
- Produces: `tlOwn(el)` widened to `closest('#tl, #threads')`, `holding()`'s exception to `#tl, #threads`, `tlHitAt` → null when the topmost element at the point is in `#threads` (spec §2.1 "The panel is the layer's own"); `tState(t) → 'ready' | 'you' | 'wait'` (open threads only); `tCounts(threads) → { open, you, ready, wait }`; `tButton(counts) → { cls: 'ok'|'you'|'wait'|null, n, title }`; `thDraw()` (draws head counts, tabs, pane; called from `tlDraw()` and after `render()`); `TH = { th: null|'open'|'resolved', t: null|string }` set by the router before drawing; DOM ids `#threads`, `#th-tabs`, `#th-body` > `#th-pane` + `#th-card-slot.no-shell`, `#th-close`, `#ask-threads`, `#tl-list`, `[data-thf]`, `button.th-row[data-tl-open]`, `.th-st.ok|.you|.wait`, `.tt .n.th.<cls>`.
- Consumes: block `threadsTabs`, `tabBar`, `bindTabBar`; kit-87's `route()` and page head state.

- [ ] **Step 1: Write the failing test** `test/dashboard-threads-sidebar.test.mjs` with a fixture built on `threadsFixture('threads-sidebar')`: two open questions (`F.sup(['ask', …])`); a second goal `G2` (`F.sup` with the fixture's goal args, priority 2) with no thread; `goalArgs` isn't exported by `threadsFixture`, so the test copies its argument list for `G2`; threads by CLI: `A` subjectless, owner then `thread reply` (your move); `B` owner only (waiting); `C` owner, reply, `thread ready --outcome "done"` (ready); `G` with `--subject '{"kind":"item","ref":"goal:<F.goal>"}'` and a reply (your move); `X` owner only, subject `{"kind":"item","ref":"ticket:kit-gone"}` (waiting, subject not drawn); two more resolved. Subtests run in spec §3's order (AC1, AC3's first counts, AC2, then the rest). Local helpers copied in shape from `dashboard.test.mjs` (`soonIn`, `POLL_FAST`). Subtest "the panel and its button" asserts at 1440x900 on `#overview`:
  - `.pagebar .tt` text starts "Inbox", red count `2`, `.n.th.ok` text `3`, `title` "1 ready to accept, 2 your move", `aria-label` contains "2 open questions";
  - click `.tt` → `location.hash === '#overview?th=open'`, `body.classList.contains('threads-open')`, `.main` right margin `380px`, `.tt` `visibility` `hidden`;
  - `.threads-head` height 49 and its bottom within 1px of `.pagebar`'s;
  - `threadsTabs.list().map(t => [t.id, t.disabled])` deep-equals `[['threads',false],['supervisor',true],['shell',true]]`; the Threads tab's `.n.blue` is `2`;
  - `[data-thf="open"]` reads "Open 5" and pressed; `[data-thf="resolved"]` "Resolved 2";
  - the disabled tabs' `title`s as spec §2.1; `.tt`'s `aria-label` and `title` carry the counts;
  - five rows; the `A` row has `.th-st.you` (`title` "Your move", `aria-label` same) and bold headline (`font-weight >= 600`); `B` `.th-st.wait`; `C` `.th-st.ok`; `G` row has `.pinchip` text = its pin number and "Goals"; no row has a third line;
  - `#th-close` click → `#overview`, no `threads-open`, `.tt` visible; `#overview?th=inbox` loads the Inbox page; Shift held over the open panel shows no pin (`#tl-cursor` hidden);
  - `.main`'s right edge moves left by 380 ±1 between closed and open;
  - Review Focus 4 and 5 assertions (above).
  Subtest "the counts as threads move" (AC3's later states, run after AC2): `thread resolve <C> --accept` → `.n.th.you` with the your-move count; `thread say` on each your-move thread → `.n.th.wait` counting the open threads, and the Threads tab shows no number (`.n` absent or empty); resolve every open thread → no `.n.th`.
- [ ] **Step 2:** `timeout 600 node --test --test-concurrency=2 test/dashboard-threads-sidebar.test.mjs` → FAIL (no `#threads`).
- [ ] **Step 3: Implement.** Markup `<aside class="threads" id="threads" aria-label="Threads">` per spec §2.1, a child of `<body>` after `#tl`. Register the three tabs once at load; after each `tabBar` draw set the two disabled tabs' `title`s; Threads' `count()` returns null at 0. `tState`/`tCounts`/`tButton` per spec §2.3 table and §2.2. The router reads `state.th`/`state.t` of the page head into `TH` and toggles `threads-open`; `.tt`'s click assigns the current page head plus `th=open`; `#th-close` assigns it without `th`/`t`; `[data-thf]` assigns `th=<value>`. Page CSS: `.th-st` marks (7px dot, ring, green check), `.th-row` grid as the mock's `.titem`, `.pinchip`, `:where(.shell).threads-open .pagebar .tt, :where(.shell).threads-open #tt-peek { visibility: hidden }`. `askDraw()`'s target list becomes `['ask-inbox', 'ask-dock', 'ask-threads', 'tl-c-ask']` (the dock stays until T2). Button and pane written only when their HTML changed and `!tlHeld`.
- [ ] **Step 4:** the new file, `test/dashboard.test.mjs` (dock still there), `test/dashboard-pages.test.mjs` (its AC 1a updated) and `test/dashboard-peek.test.mjs` → each PASS.
- [ ] **Step 5:** commit "kit-89: T1 the panel, its tabs, the list and the button's counts"; task review `reviews/task-1.md`.

### Task 2: Reading threads in the panel and beside their subject; the dock goes

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (`tlCard`, `tlPlaceCard`, `tlClose`, `tlOpen`, the click handler, `tlDock` removed, dock markup/CSS removed, Escape)
- Modify: `test/dashboard.test.mjs` (the dock-driving lines: ~536, ~1881, ~2534–2541, ~3334–3375, ~3597–3605), `test/pane-question.answer.test.mjs` (~242–245)
- Test: `test/dashboard-threads-sidebar.test.mjs`

**Interfaces:**
- Consumes: T1's `TH`, `thDraw`, `tState`.
- Produces: `tlInPanel(t) → boolean` (no subject, or `tlTargetRect(subject)` null for a page subject or item); `#tl-card.in-panel` inside `#th-card-slot`, moved only when `tlInPanel` flips (or a panel draft starts/ends); `[data-tl-back]`; `#tl-pinbtn` and `[data-tl-new]` in `.threads-head .end`.

- [ ] **Step 1: Failing subtests** "opening threads": clicking `A`'s row → hash `…?th=open&t=<A>`, `#th-card-slot #tl-card.in-panel` shows `A`'s turns and `#tl-c-text`, `[data-tl-back]` present; back → `…?th=open`, list shown. Review Focus 1 (type in `#tl-c-text`, wait past a threads poll and a 10-second redraw: `window.__renders` grows by one and `/api/threads` is asked again; value, `selectionStart` and `document.activeElement` kept). `X`'s row opens it in the pane. On `#goals`: Shift+click `G2`'s card (as `dashboard.test.mjs` does) → floating draft beside it; send "hello" → listed with pin number; with the panel open its card's right edge ≤ `innerWidth − 380`. From `#overview?th=open`, click `G`'s row → hash `#goals?th=open&t=<G>` with `history.length` up by exactly one, goal card in view, floating `#tl-card` not `.in-panel`, row `aria-current="true"`; Back → `#overview?th=open`. `+` opens an in-panel draft focused. `document.getElementById('tl-pill') === null && !document.getElementById('tl-dock')`. A `#talk/<A>` link clicked on Board → `#board?th=open&t=<A>`. With a ticket's peek open over Board, `G`'s row closes the peek and lands on `#goals…t=<G>` with the card open. Escape with the focus in the in-panel composer and a peek open closes the in-panel thread, not the peek.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** per spec §2.4, §2.6, §2.9: `tlCard()` appends `#tl-card` to `#th-card-slot` when `tlInPanel` (or a subjectless draft) and it isn't there already, else back to `#tl` when it isn't there; `.tl-card.in-panel` page rule (static, slot width, no frame, no max-height); `tlPlaceCard` passes `innerWidth - (threads open && innerWidth > 900 ? threadsW : 0)` to `tPlace`, `threadsW` read once from `getComputedStyle(document.body).getPropertyValue('--threads-w')`; row clicks: in-panel threads assign `t`; floating ones assign one head, the subject's page head (as kit-87's `tlGoTo` computes it) with `th` kept and `t` set, then scroll and open as `tlGoTo` does, so the move is one entry; `talk/` to an in-panel thread rewrites to `<page>?th=open&t=<id>` through kit-87's `withPage` path; delete dock markup, `tlDock`, `#tl-pill` handling and listed CSS; Escape order per §2.9.
- [ ] **Step 4:** migrate the listed `dashboard.test.mjs` lines: pill text/dot checks → `.tt .n.th` and row marks; `#tl-pill` clicks → `.tt` click (or `#overview?th=open`); `#tl-list [data-tl-open]` stays (the id and attribute are kept); `.tl-resolved` → `[data-thf="resolved"]` then the row; viewer "the dock" (~1881): in T2 it becomes `!document.getElementById('tl-pill')` plus `#threads` present (the panel is reachable code-wise); T4 then adds `#tt-peek` visible. `pane-question.answer.test.mjs`: open `.tt`, expect `#ask-threads [data-ask-option]`, assertion kept. Run the new file, `dashboard.test.mjs`, `pane-question.answer.test.mjs`, `dashboard-pages.test.mjs`, `dashboard-peek.test.mjs` → each PASS.
- [ ] **Step 5:** commit "kit-89: T2 threads read in the panel and beside their subject; the dock goes"; `reviews/task-2.md`.

### Task 3: History, reload and the remembered panel

**Files:** Modify `docs/devteam/dashboard/index.html` (router); Test `test/dashboard-threads-sidebar.test.mjs`.

**Interfaces:**
- Consumes: block `withPage`, `stampFor`; kit-87's freshness flag (no `history.state` on arrival).
- Produces: `thGo({ th, t })` — the one function every Threads control calls (in the `/view/` tab it sets `TH` and draws, no hash): under a link head (peek) `history.replaceState(withPage(history.state, head), '', location.href)` then route; else `location.hash = head`. `THREADS_KEY = 'devteam.threads.open'`.

- [ ] **Step 1: Failing subtests** "a peek and a thread over a reload" (spec AC6) and "reload and Back" (spec AC7), plus Review Focus 2 and 3, and: `#overview?th=bogus&t=BAD!` → hash `#overview`, panel closed; closing a floating card (×) → a new entry without `t`, Back reopens it; Back after the in-panel back arrow reopens the thread; a resolved thread's `t` survives a reload (Reopen shown); a floating `t` alone isn't stored (`localStorage['devteam.threads.open']` absent); Escape on the list closes the panel and `document.activeElement` is `.tt`; × does the same; opening by `.tt` focuses the selected tab.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** spec §2.5: route T1/T2's hash assignments through `thGo`; on every route write `THREADS_KEY` (`{th, t}` only while `th` is set, else remove; a floating `t` alone is not stored); on a fresh page-head entry with neither key, apply the stored ones by `replaceState` (stamped); drop an unknown `t` once `/api/threads` has answered; bad `th`/`t` values checked after `parseHead` in the router (never the block) and dropped by stamped `replaceState`.
- [ ] **Step 4:** the four files of Global Constraints → each PASS.
- [ ] **Step 5:** commit "kit-89: T3 Threads in history, under a peek and remembered"; `reviews/task-3.md`.

### Task 4: With the artifact viewer, and the `/view/` tab

**Files:** Modify `docs/devteam/dashboard/index.html` (`openArtifact`, `openPreview`, their closes, `#tt-peek`'s observer, page CSS, viewer boot); Modify `test/dashboard.test.mjs` (the viewer "whole tab" and "dock" assertions ~1878–1881); `test/dashboard-peek.test.mjs` only if the Q5 ruling adds it and a line breaks; Test the new file.

**Interfaces:** Produces `av-open` on `document.body` while `#artifact-view` shows; CSS `--av-right` on `.shell.threads-open` above 900px.

- [ ] **Step 1: Failing subtest** "with the viewer" (spec AC4 in full: `#tt-peek` at the top right is `elementFromPoint`'s hit above the viewer, opening the panel above it, `#scrim` background equals `--backdrop`, `getComputedStyle(document.body).getPropertyValue('--av-right').trim()` resolves to 396px at 1440 while open, unset after close, panel left 0 at 720x800; with a peek and the panel: drawer right = panel left ±1, `elementFromPoint` inside the panel is in `#threads`, the three bars' bottoms level ±1). No Inbox button inside `#artifact-view` (`#artifact-view .tt, #artifact-view [data-inbox]` none). Viewer opened over a peek: `#tt-peek` at the top right. At 720x800 with the viewer up: `#tt-peek` hidden. With a peek open, `#tt-peek`'s `aria-label`/`title` equal `.tt`'s. And spec AC9 at `/view/artifact/<slug>`: `#tt-peek` visible at the top right with the thread count, `#artifact-view` top = 49, click opens `#threads` with the list, a subjectless row opens in the pane, × closes, no `/api/data` asked.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** spec §2.7–§2.8: toggle `av-open`; `#tt-peek` shows under `.shell.av-open:not(.threads-open)` (also with `peek-open`, the rule written after kit-88's) and `.viewer`, at right `--header-pad`, z 24 (above `#artifact-view`'s 22), hidden at ≤900px while `av-open` (not in `.viewer`); the observer copies `aria-label` and `title`; `.threads` z 23 under `av-open` and `.viewer`; `@media (min-width: 901px) { :where(.shell).threads-open { --av-right: calc(var(--threads-w) + 16px) } }`; `.viewer #artifact-view:not([hidden]) { top: var(--bar-h) }`; in the viewer, `thGo` toggles `threads-open` on `<body>` itself (no router there) and `thDraw()` writes `#tt-peek` directly from `TL.threads` and `/api/hello`'s `inbox` (kept from the hello it already polls), and `#tt-peek`'s click calls `thGo({ th: 'open' })`.
- [ ] **Step 4:** update the `dashboard.test.mjs` viewer assertions (rect top 49, `#tt-peek` shown) and, in `dashboard-peek.test.mjs`, only the lines this placement or the copied attributes move (assertions kept); the four files → each PASS.
- [ ] **Step 5:** commit "kit-89: T4 the panel beside the viewer, and in the /view/ tab"; `reviews/task-4.md`.

### Task 5: The measure, the string sweep, verification

**Files:** Modify `test/dashboard-measure.test.mjs`; any of `test/gateway.test.mjs`, `test/multirepo-views.test.mjs`, `test/ooda-learning.test.mjs`, `test/ooda-lineage.test.mjs`, `test/plain-questions.test.mjs`, `test/fleet-park.test.mjs`, `test/multirepo-landing.test.mjs`, `test/lib/kit.mjs`, `test/lib/chain.mjs` only where a string check reads markup this ticket changed; create `docs/devteam-dev/tickets/kit-89-threads-sidebar/verification.md`.

- [ ] **Step 1:** add three `PAGES` entries on a project seeded like T1's fixture (a second project, as kit-88 did, so earlier entries keep their data): `#overview?th=open`; `#overview?th=open&t=<A>`; `#goals?t=<G>`; each with `ready` waiting for the panel/card drawn, `opts.inbox` pointing at the visible button (`#tt-peek` when shown, else a selector matching nothing, as kit-88's peek entries), `opts.prose` adding `#tl-card .tl-turn-text` (the turn text class as merged).
- [ ] **Step 2:** `timeout 900 node --test --test-concurrency=2 test/dashboard-measure.test.mjs` → fix what fails in page CSS (never the measure) until PASS.
- [ ] **Step 3:** `grep -n -E "tl-pill|tl-panel|tl-dock|ask-dock|tl-resolved|tl-row" <each touched test file>`; update any hit; run each changed file alone → PASS.
- [ ] **Step 4:** push; the CI run (`gate ci -- gh run watch …` per memory: the real command, its own exit) green at the head; `verification.md` one row per done-when with command, result and commit.
- [ ] **Step 5:** commit "kit-89: T5 measure entries, sweep, verification"; `reviews/task-5.md`; then finishing per worker.md §8.

## Self-review notes

Spec coverage: §2.1–2.3 → T1; §2.4, 2.6, 2.9 → T2; §2.5 → T3; §2.7–2.8 → T4; AC8 → T5; AC5 → T2 step 4 and every task's `dashboard.test.mjs` run. The kit-145 badge is a note, carried in T2 only if kit-145 has merged by then.

## Rulings

- `m-20261115-205924178-supervisor`: Q3 yes (kit-84's rule for your move), Q4 yes (a row goes to its subject's page; an open peek closes), Q5: `test/dashboard-pages.test.mjs` and `test/dashboard-peek.test.mjs` in touches; keep their assertions, change only navigation.

- `m-20261115-203750802-supervisor`: plan ahead; build after kit-88 merges and approve-plan.
- `m-20261115-204940196-supervisor`: `test/pane-question.answer.test.mjs` in touches, its dock check moved to the panel with its assertion kept; the `/view/` tab gets the floating Inbox button and the panel (spec §2.8).
