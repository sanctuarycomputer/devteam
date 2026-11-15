# kit-88-side-peek: plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- One file changes in product code: `docs/devteam/dashboard/index.html`, outside both shell blocks; one new test, `test/dashboard-peek.test.mjs`, plus `PAGES` entries in `test/dashboard-measure.test.mjs`.
- T1 ports the drawer onto the block's frame (`peek-open`, slide, scrim, header at `--bar-h`, the top-right button left of the peek) and keeps `#drawer.hidden` meaning "closed", set after the slide.
- T2 makes every peek start with `section.attrs` > `dl.props` (ID first, a tooltip on every key, How it changes), sections as cards, History last.
- T3 leaves only the allowed writes: Retire it starts a thread, a settled question's peek is read-only.
- T4 asserts the design's peek inventory item by item; T5 makes every record card, Progress row and dbTable row open its peek, with the ⋯ menu.
- T6 adds one peek per kind to the measure; T7 runs and repairs the other touched tests.
- Build waits for kit-87's merge and approve-plan; tasks T2–T7 assume kit-87's page bar (`.pagebar`, `.tt`) and pages as merged, and T1 starts by reading them.

**Goal:** the spec, `docs/devteam-dev/tickets/kit-88-side-peek/spec.md`, in the kit's dashboard.

**Architecture:** page CSS and JS added after the `devteam-layout` and `devteam-shell-js` blocks (never in them), calling the block's `props()`, `bindDbTable` and the frame's `peek-open` state. Today's openers keep their structure; `attrs()`, `showDrawer()`/`closeDrawer()` and a few helpers change under them.

**Tech stack:** one inline HTML page, vanilla JS; `node:test` with headless Chrome through `test/lib/chrome.mjs`; the measure through `test/lib/measure.mjs`.

**Spec:** `docs/devteam-dev/tickets/kit-88-side-peek/spec.md`

## Global constraints

- Neither `devteam-layout` nor `devteam-shell-js` changes by one byte (`test/dashboard-shell.test.mjs` holds them identical to `hub.html`'s).
- Files: only those in the ticket's `touches`, plus `test/dashboard-owner-action.test.mjs` (ruling `m-20261115-195457593-supervisor`).
- Ids kept: `#scrim`, `#drawer`, `#drawer-body`, `#drawer-close`, `#drawer-bar-title`, `section.attrs`, `h4.attrs-h`.
- Tokens used, never redefined: `--dur` (280ms; 0 under reduced motion), `--ease` (`cubic-bezier(.32,.72,0,1)`), `--bar-h` (49px), `--panel-pad` (16px), `--header-pad` (16px), `--backdrop` (`rgba(0,0,0,.7)`, 4px blur).
- Allowed writes in a peek: a goal's `holdControl` (Run, Drain, Park, Let go + confirm, Restore), the goal impact form (`data-correct="imp:…"`), and any Correct drawn today.
- Tests: run only touched files, one at a time, `node --test --test-concurrency=2 <file>`, through `devteam.mjs gate`; judge by the exit code, never a pipe (lesson `k-20261115-164245020`). Any kit run outside the tests uses its own `HOME`, a hub port away from 4320 and `DEVTEAM_*` unset (`k-20261115-080753394`). Multi-step shell goes in a script file; `rm -rf` only on `"${S:?}/…"` paths; never `prlimit --as` on node (`k-20261115-182656232`).

## Review focus

1. Close then reopen within 280ms: the pending hide must not fire on the reopened drawer. T1 test `reopen during close stays open`.
2. The 10-second refresh redraw while a peek is open must not replay the slide or drop focus. T1 test `a redraw does not re-slide`.
3. A peek whose record is missing (`notFound`) or still loading must still lead with ID and How it changes, and end with History. T2 test `notFound and loading keep the frame`.
4. A click on a link or a control inside a record card (a pill link, the ⋯ button, a hold button) must do that control's thing, not open the card's peek. T5 test `inner controls keep their click`.
5. Copy ID where the clipboard is refused says so instead of failing silently. T5 test `copy refused`.

---

### Task 1: The frame slides

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (the page CSS for `.scrim`, `.drawer`, `.drawer-bar`, `.drawer dl/dt/dd/h3` at ~501–597; the drawer markup at ~938–941; `showDrawer`, `closeDrawer`, `hideDrawer`, `openReview`'s drawer close, the viewer's scrim handling ~2240, ~4231–4264, ~4321)
- Create: `test/dashboard-peek.test.mjs`
- Modify: `test/dashboard.test.mjs`, `test/lib/chain.mjs` (only where they name `.drawer-bar` or expect `hidden` synchronously on close)

**Interfaces:**
- Produces: `peekShow()` (unhide, flush, add `peek-open` to `document.body`), `peekHide({ now = false } = {})` (remove `peek-open`; set `hidden` on `#drawer`/`#scrim` on `transitionend` of `transform` or after `--dur`; `now` hides at once). Every place that today sets `$('drawer').hidden`/`$('scrim').hidden` goes through them. A test helper `peekPage(t, { seed })` in `test/dashboard-peek.test.mjs` that starts a dashboard on a seeded project and a Chrome page (shape of `dashboard-measure.test.mjs`'s setup, with its own `HOME` and ports).

- [ ] **Step 1: Read kit-87's merged frame.** Note where `no-shell` sits on `#scrim`/`#drawer`, the top-right button's selector and markup, and any drawer CSS kit-87 touched. Record the selectors in this plan's Notes if they differ from `.pagebar .tt`.
- [ ] **Step 2: Write the failing tests** in `test/dashboard-peek.test.mjs`, test `the frame`:
  - open `#ticket/<id>`; sample `getComputedStyle(drawer).transform` at once (a matrix with tx ≥ drawer width), at ~140ms (0 < tx < width) and after 400ms (`none` or identity); assert `transitionDuration` includes `0.28s` and `transitionTimingFunction` is `cubic-bezier(0.32, 0.72, 0, 1)`;
  - close with `#drawer-close`: within 100ms `drawer.hidden === false` and tx > 0; after 400ms `hidden === true` for `#drawer` and `#scrim`;
  - `reopen during close stays open`: close, then reopen at 100ms; after 400ms open, tx identity;
  - `a redraw does not re-slide`: with a peek open, call `refreshDrawer()`; `body.classList.contains('peek-open')` throughout and transform stays identity;
  - reduced motion (`Emulation.setEmulatedMedia` `prefers-reduced-motion: reduce`): `transitionDuration` is `0s`; close sets `hidden` within one task;
  - bars: `.drawer-head` height and `.pagebar` height equal `--bar-h`; their `getBoundingClientRect().bottom` within 1px; `#drawer-close`'s right is `drawer.right − 16` ±1;
  - the top-right button (from Step 1): at 1440×900 its right ≤ drawer's left − 16 ±1 and its `elementFromPoint` centre is the button (above the scrim); at 720×800 it is not rendered or zero-size;
  - header icon: for each `TYPE_META` kind opened, `#drawer-bar-title .dtype i` has class `icon-<icon>` and precedes `.badge` with the label;
  - scrim: `getComputedStyle(scrim).backgroundColor` is `rgba(0, 0, 0, 0.7)` and `backdropFilter` is `blur(4px)`.
- [ ] **Step 3: Run** `node docs/devteam/scripts/devteam.mjs gate peek -- node --test --test-concurrency=2 test/dashboard-peek.test.mjs`; expect FAIL (no slide, `.drawer-bar`).
- [ ] **Step 4: Implement.** Take `no-shell` off `#scrim`/`#drawer`; markup `<div class="drawer-head"><h2 id="drawer-bar-title"></h2><span class="end"><button class="ghost icon-btn" id="drawer-close" aria-label="Close">…</button></span></div><div class="drawer-body" id="drawer-body"></div>`; delete the page's `.scrim`, `.drawer`, `.drawer-bar*` rules and narrow `.drawer dl/dt/dd` to what `.props` doesn't style; `peekShow`/`peekHide` as above, a module `PEEK_HIDE` timer cleared by `peekShow`; the top-right button rule `.shell.peek-open:not(.threads-open) <button> { position: fixed; top: <its top>; right: calc(min(720px, 100vw) + var(--header-pad)); z-index: 22 }` and `@media (max-width: 760px) { … { visibility: hidden } }`.
- [ ] **Step 5: Run** the peek test (PASS), then `test/dashboard.test.mjs` and `test/lib/chain.mjs`'s users through `gate`; fix only selectors and synchronous-`hidden` expectations (use `soon(...)`).
- [ ] **Step 6: Commit** `kit-88: the peek slides on the shell's frame`.

### Task 2: Properties first, How it changes, History last

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (`attrs`, `attrRow`, `attrKey`, `notFound`, every `open*` opener ~3296–4060, `historySection`)
- Modify: `test/lib/kit.mjs` (add `peekFixture`)
- Test: `test/dashboard-peek.test.mjs`

**Interfaces:**
- Consumes: block `props(rows)` → `dl.props`, rows `[key, valueHtml, tip]`.
- Produces: `KEY_TIPS` (label → tip), `howItChanges(kind, rec) → [label, html, tip]`, `psect(title, html) → '<div class="card psect"><div class="card-head"><span class="grow">…</span></div><div class="psect-body">…</div></div>'`, `attrs({ …today's options, kind })` emitting `section.attrs` > `dl.props` (ID, stored, Created, Last changed, How it changes) [+ `h4.attrs-h` Computed + `dl.props`]. `peekFixture(base) → { root, ids: { ticket, goal, feature, story, release, wave, milestone, act, decision, lesson, problem, incident, signal, observation, learning, retro, thread, planner, qAnswered, qDefaulted, qWithdrawn, qOpen, file, governanceFile, sensorHttp, sensorReader } }` in `test/lib/kit.mjs`, built from `bareProject` plus log lines (`line(...)`) and files, so every peek kind has a record.

- [ ] **Step 1: Write `peekFixture`** and a test `the fixture draws every kind` that opens each id's hash and waits for `#drawer-body section.attrs` (fails now for kinds that lead with something else; that is Step 2's red).
- [ ] **Step 2: Write the failing test** `properties first`, for every kind in `ids`: `#drawer-body > :first-child` matches `section.attrs`; `section.attrs dl.props dt:first-of-type` text `ID`; every `dt` in the peek has a non-empty `title`; `getComputedStyle(dt).fontFamily` equals the computed `--mono` stack; first `dt`/`dd` `borderTopWidth` is `0px`; a `dt` reads `How it changes` with the kind's text (§2.2 table: act/decision "Correct, on its row in Self Improvement"; answered/defaulted question links `#inbox`; withdrawn "Withdrawn: nothing changes it"; thread "Reply in its thread"; governance file "The supervisor drafts it from your thread; it lands with your yes"; else "Shift+click it and say so in a thread"); the body's last `.psect` head reads `History`. Plus `notFound and loading keep the frame`: `#ticket/kit-nope` and a peek fetch held open (route `/api/peek` stalled via `Fetch.enable`) both show ID, How it changes, History.
- [ ] **Step 3: Run**; expect FAIL.
- [ ] **Step 4: Implement** `attrs` on `props()`; `KEY_TIPS` covering every label any opener passes (grep the openers' row labels; a vm check in the test lists any label drawn without a tip); `howItChanges`; `psect` and convert each opener's `<h3>…</h3>` section to `psect(...)`; move each opener's lead-in (file view bar, `[data-from]`, sub-lines) below `attrs`; give every early return `historySection`; remove the hint lines How it changes replaces.
- [ ] **Step 5: Run** the peek test (PASS) and `test/dashboard.test.mjs` (its `.attrs dt` lookups keep working; fix label text only if a label moved).
- [ ] **Step 6: Commit** `kit-88: every peek opens with its properties`.

### Task 3: Nothing permanent in a peek

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (`openLesson` ~3739, `openQuestion`, `answeredCard`, the `data-know` click handler, a new `data-thread-on` handler)
- Modify: `test/dashboard-owner-action.test.mjs` (ruling `m-20261115-195457593-supervisor`): its positive control moves to the Inbox lesson card's Retire it (posts `{ id, status: 'retired' }`), and beside it a test that the lesson peek's Retire it starts a thread draft (`TL.draft.subject.ref === 'lesson:<id>'`) and posts nothing to `/api/knowledge`
- Test: `test/dashboard-peek.test.mjs`

**Interfaces:**
- Consumes: `tlStart({ subject: { kind: 'item', ref }, title, x, y })` (threads-layer, unchanged).
- Produces: `answeredCard(q, { inPeek = false })` (no Overrule form when `inPeek`); `[data-thread-on="<kind>:<id>"]` buttons handled by one delegated listener calling `tlStart` with the button's rect centre.

- [ ] **Step 1: Write the failing tests** `no permanent action`: stub `window.fetch` to record non-GET calls; for every kind, list `#drawer-body button, input, select, textarea, form`; each either matches `[data-hold-id], [data-correct], [data-correct-send], [data-impact], [data-reason], [data-mdview], [data-thread-on], [data-card-menu], summary` or, when clicked, records no non-GET request; `Retire it` on the lesson peek: click → `TL.draft.subject.ref === 'lesson:<id>'` and no POST; defaulted question peek: no `[data-overrule]`, its How it changes link goes to `#inbox` and the Inbox card `#q-<id>` there has `[data-overrule]`; `#q/<open id>` → `location.hash === '#inbox'` and `#q-<id>` in view.
- [ ] **Step 2: Run**; FAIL (Retire it posts; Overrule in peek).
- [ ] **Step 3: Implement** the changes in spec §2.3.
- [ ] **Step 4: Run** the peek test and `test/dashboard-owner-action.test.mjs`; PASS.
- [ ] **Step 5: Commit** `kit-88: no permanent action in a peek`.

### Task 4: Every detail stays

**Files:**
- Modify: `test/lib/kit.mjs` (`peekFixture` gains what the inventory needs: gate runs incl. a flaky one, spend lines, a handoff, an incident with fingerprints and raw events, a retro pair, a planner draft board, a learning record, a reader sensor with an ignored list)
- Modify: `docs/devteam/dashboard/index.html` only where an item is found missing
- Test: `test/dashboard-peek.test.mjs`

- [ ] **Step 1: Write one assertion per inventory item** (the design's "Every detail and widget stays" list, copied into the test as a table `{ kind, item, selectorOrText }`): e.g. ticket `Done when` dt, `Spent` computed dt, the dependency graph `.graph svg, .graph .lineage-list`, gate runs `✓`/`✗`/`≈`; goal step bar `.steps`, the progress block, Forecast; file `[data-mdview="rendered"]` and `[data-mdview="raw"]`, Version, Commits; sensor p50/p95 charts `svg` with the target line; incident raw events `details.untrusted`; and so on through the list. Where the fixture can't produce an item, inject it in the page (`PEEKS.set(...)`/`DATA` patch, then `redraw()`), commented with why.
- [ ] **Step 2: Run**; every failure is either a fixture gap (fix the fixture) or an item T2/T3 dropped (restore it).
- [ ] **Step 3: Commit** `kit-88: the peek inventory, item by item`.

### Task 5: Every row and card opens its record

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (Board's `tcard` ~1520, goal card ~2690–2702, Progress rows, the Loop/Sensors `data-open` cards, the `[data-open]` click handler ~4284, a keydown handler, `cardMenu`)
- Test: `test/dashboard-peek.test.mjs`

**Interfaces:**
- Produces: `cardMenu(kind, id) → '<button type="button" class="ghost icon-btn end" data-card-menu="<kind>/<id>" aria-label="More">⋯</button>'`; a popover `#card-menu` with `[data-menu-open]` (Open in side peek) and `[data-menu-copy]` (Copy ID; "Copied" or "Couldn't copy"); `peekFor(kind, id) → '#<kind>/<encoded id>'`.

- [ ] **Step 1: Write the failing tests** `rows and cards`: Board ticket card click and Enter (focused) → `#ticket/<id>`; Progress row click and Enter → its peek; each `[data-open]` card's title link → its peek; its ⋯ → menu with exactly `Open in side peek` and `Copy ID`; Open → its peek; Copy ID with `navigator.clipboard.writeText` stubbed to resolve → called with the id, "Copied"; `copy refused` (stub rejects) → "Couldn't copy"; no `a` whose text is `Open` inside any `[data-open]` card or goal card; `inner controls keep their click`: clicking a link or a hold button inside a card doesn't set the card's hash. Fixture: load `test/fixtures/dashboard-shell.html` with its slots filled the way `dashboard-shell.test.mjs` does, evaluate `bindDbTable(document.getElementById('table-card'), { onOpen: (i) => { document.querySelector('#drawer h2').textContent = ROWS[i][0]; document.body.classList.add('peek-open'); } })` after removing `peek-open`; click row `data-row=1` → `peek-open` set and header `kit-2`; focus row `data-row=0`, Enter → `kit-10`.
- [ ] **Step 2: Run**; FAIL.
- [ ] **Step 3: Implement** spec §2.5: `tcard` becomes `div[role=button][tabindex=0][data-open]` (keep class `tcard`, `inert` cards unchanged), goal cards gain `data-open`, `tabindex=0`, a title link and `cardMenu`, their Open link goes; `[data-open]` cards gain `cardMenu`; one keydown handler opens a focused `[data-open]` on Enter; Progress rows get `data-open`/`tabindex=0`.
- [ ] **Step 4: Run** peek test and `test/dashboard.test.mjs` (`button.tcard` selectors there move to `.tcard`); PASS.
- [ ] **Step 5: Commit** `kit-88: every card and row opens its record`.

### Task 6: The measure

**Files:**
- Modify: `test/dashboard-measure.test.mjs` (`PAGES`, and its project seeded with `peekFixture`)
- Modify: `docs/devteam/dashboard/index.html` for whatever the measure finds in peeks

- [ ] **Step 1:** add `{ hash: '#<kind>/<id>', ready: "!document.getElementById('drawer').hidden && !!document.querySelector('#drawer-body section.attrs') && document.body.classList.contains('peek-open')", opts: { view: '#drawer-body', ignore: [...] } }` for each kind, `ignore` naming only the page under the peek (`main`, `.pagebar` for `page-top`/`header-pad`, as measure.mjs's options allow).
- [ ] **Step 2: Run** `gate measure -- node --test --test-concurrency=2 test/dashboard-measure.test.mjs`; fix each failure in page CSS (prose width inside psects, overflow of wide values, card head ends).
- [ ] **Step 3: Commit** `kit-88: one peek of each kind under the measure`.

### Task 7: The other touched tests

**Files:** `test/gateway.test.mjs`, `test/multirepo-views.test.mjs`, `test/ooda-learning.test.mjs`, `test/ooda-lineage.test.mjs`, `test/plain-questions.test.mjs`, `test/fleet-park.test.mjs`, `test/multirepo-landing.test.mjs`, `test/lib/chain.mjs`

- [ ] **Step 1:** run each, one at a time, through `gate`; for each failure decide whether it is markup that moved (fix the test's selector) or behaviour lost (fix the page). Never weaken an assertion about what the owner sees.
- [ ] **Step 2: Commit** `kit-88: tests follow the peek's markup`.
- [ ] **Step 3:** verification.md (a row per done-when, command, result, commit), then finishing per worker.md §8.

## Rulings

- `m-20261115-195003493-supervisor`: plan ahead; build after kit-87 merges and approve-plan.
- `m-20261115-195457593-supervisor`: `test/dashboard-owner-action.test.mjs` in touches; keep the peek's Retire-it-starts-a-thread, posts-nothing test beside the moved positive control.

## Notes

- Execution: subagent-driven, task by task, a review record per task (`reviews/task-<n>.md`); briefs carry the three lessons and the scripts-in-files rule.
