# kit-100-inbox-in-panel Implementation Plan

## TL;DR

- **Waits for kit-89.** Build starts only once kit-89 (and through it kit-87 and kit-88) has merged and approve-plan is recorded. T0 merges main and reconciles every name in spec §7 against the merged code.
- **Seven tasks.** All product code is in `docs/devteam/dashboard/index.html`. There is one new test, `test/dashboard-inbox-panel.test.mjs`. The touched tests change only where they assert the interim Inbox page (ruling `m-20261115-225154606`).
- **The move.** Today's `#inbox` section moves whole into kit-89's `#th-body` as `#th-inbox`, keeping its children's ids, so `render()` and the Inbox handlers don't change. The Inbox tab registers first and only shows or hides that element.
- **One URL value.** `th=inbox` opens the Inbox tab. Every road into the Inbox lands there: the button, `#q/<id>`, old `#inbox` and `#questions`, in-page Inbox links and the review's cold close. The nav item and the `inbox` page go.
- **Threads on questions.** Their home is the Inbox tab. Pins draw above the panel, the card sits just left of it, and Shift+click works inside `#th-inbox` only.
- **Typing is kept.** kit-89's `#threads` exceptions (holding, draft keeping, own presses) narrow to exclude `#th-inbox`.
- **Risk.** Three unmerged tickets sit under this plan. Names may differ once they land, and T0 reconciles them; a real conflict goes to the supervisor.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Inbox moves into the side panel as its first tab, and leaves the nav.

**Architecture:** One DOM element moves rather than being redrawn. Routing changes in the page's own `SHELL_ROUTES` and kit-89's `th` handling. The thread layer's notion of "the panel is mine" gets one carve-out, `#th-inbox`.

**Tech Stack:** Inline HTML/CSS/JS in `index.html`; `node:test`; headless Chrome via `test/lib/chrome.mjs`; `test/lib/measure.mjs`; `vm` for the routes table.

**Spec:** `docs/devteam-dev/tickets/kit-100-inbox-in-panel/spec.md`. Read it with this plan: section numbers below are the spec's.

## Global Constraints

- **Files:** only the ticket's touches plus the nine ruled in by `m-20261115-225154606-supervisor`:
  - `test/dashboard-shell.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard-peek.test.mjs`, `test/pane-question.answer.test.mjs`, `test/next-step.strategy.test.mjs`, `test/browser/dev-links.mjs`;
  - `test/dashboard-answers.test.mjs` and `test/dashboard-owner-action.test.mjs`, navigation only;
  - and this ticket's folder.
  
  Change only interim-Inbox assertions in the nine.
- **Not changed:** `devteam-layout`, `devteam-shell-js`, `threads-core`, `measure.mjs`, `hub.html`, `/api/*`.
- **Copy, exactly:**
  - the tab label "Inbox";
  - the `/view/` line "Answer questions on the dashboard." linking to `/#overview?th=inbox`;
  - the redirects `inbox: 'overview?th=inbox'` and `questions: 'overview?th=inbox'`.
- **Ids kept:** `#ask-inbox`, `#questions`, `#answered-wrap`, `#answered-sum`, `#answered`, `#q-<id>`, `#a-<qid>`. Ids new: `#th-inbox`.
- **On the box:** run only touched test files, one at a time, `node --test --test-concurrency=2 <file>`, each under `timeout 900`. CI (`test.yml`) is the gate. Gates run through `devteam.mjs gate`.
- **Subagent briefs** carry the rules on scripts in files, guarded `rm -rf`, private `mktemp` scratch, and timeouts on everything (lessons `k-20261115-182656232`, `k-20261115-080753394`). Any kit run outside the tests gets its own `HOME` and ports, with `DEVTEAM_*` unset.
- **Review rounds are capped** (trial `a-20261115-214153204`). After round two, Minor findings are fixed and disposed with no further pass.

## Review Focus

1. **Half-typed words in an Inbox note while the 10-second redraw and the threads poll run.** Expected: words, caret and focus kept. Test: T5 step 1.
2. **A question answered elsewhere while a thread on it is open.** Expected: the card goes, and the thread becomes in-panel with " · subject gone", with no stale pin left floating over the panel. Test: T4 step 1, last bullet.
3. **An Inbox link clicked inside a peek.** Expected: the peek stays open, and the panel opens beside it with `history.state.page` carrying `th=inbox`. Test: T3 step 1.
4. **A cold `#talk/<Q>` or `#q/<id>` before `/api/data` lands.** Expected: no throw and no scroll to a missing card; it scrolls once the card exists. Test: T3 step 1 (cold `#q`), T4 step 1 (cold `#talk`).
5. **390px wide: a long choice detail, secret name or link in a card.** Expected: nothing sticks out of the column. Test: T6 measure entry at 390x844 with the fixture's longest strings.

---

### Task 0: Catch up on the merged base

**Files:** none changed (notes into `spec.md` §7 if names differ).

- [ ] **Step 1:** When the supervisor says kit-89 has merged: `git merge origin/main`.
- [ ] **Step 2:** Read the merged code for every name in spec §7. Grep `index.html` for:
  - `SHELL_ROUTES`, `subjectHead`, `sectionPage`, `goHead`, `openQuestion`, `hideDrawer`;
  - `#inbox-btn`, `data-answered-go`, `thGo`, `TH_MADE`, `tlInPanel`, `tlOwn`, `tlHitAt`, `holding`;
  - `in-dock`, `threads.open`, `thDraw`, `#th-body`, `#th-pane`, `#th-card-slot`.
- [ ] **Step 3:** List every Inbox read in the tests. The command `grep -n -E "#inbox|#questions|th=inbox|n-questions|nav a\[href=\"#inbox\"\]" test/*.mjs test/lib/*.mjs test/browser/*.mjs` gives the migration list for T6.
- [ ] **Step 4:** Where a merged name differs from spec §7, edit the spec's §7 and this plan's Interfaces to the merged name, and commit `kit-100: reconcile names with merged kit-87..89`. If something the spec relies on is missing (for example `tlInPanel` deciding by `tlHome`), `send supervisor … --kind design-change`.
- [ ] **Step 5:** `devteam.mjs phase build --task T1`.

### Task 1: The router's table and the nav

**Files:**
- Modify: `docs/devteam/dashboard/index.html`: the `shell-routes` block; the nav markup or `registerPage` call for `inbox`; the router's `th=inbox` lookup.
- Test: `test/dashboard-shell.test.mjs`, `test/dashboard-pages.test.mjs`.

**Interfaces:**
- Produces:
  - `SHELL_ROUTES.pages` without `inbox`;
  - `SHELL_ROUTES.redirects.inbox === 'overview?th=inbox'` and `redirects.questions === 'overview?th=inbox'`;
  - no key matching `/\?th=inbox$/`.

- [ ] **Step 1: Failing tests.** In `dashboard-shell.test.mjs`'s table test, replace the "until kit-100" assertions:

  ```js
  assert.ok(!R.pages.includes('inbox'));
  assert.deepEqual(plain(S.parseHead('#inbox', R)), { page: 'overview', state: { th: 'inbox' }, redirected: true });
  assert.deepEqual(plain(S.parseHead('#questions', R)), { page: 'overview', state: { th: 'inbox' }, redirected: true });
  for (const p of R.pages) assert.deepEqual(plain(S.parseHead(`#${p}?th=inbox`, R)), { page: p, state: { th: 'inbox' } });
  assert.ok(!Object.keys(R.redirects).some((k) => k.endsWith('?th=inbox')));
  ```

  In `dashboard-pages.test.mjs`, the nav groups become `[['Project',['Overview','Goals','Progress','Board','Library']], …]`, and the per-nav-link loop no longer visits Inbox.
- [ ] **Step 2:** Run both files. Expected: FAIL on the table and the nav.
- [ ] **Step 3:** Edit `SHELL_ROUTES` (spec §2.5): drop `inbox` from `pages` and the `PAGES.map(… '?th=inbox' …)` entries; set the two redirects; remove the `until kit-100` comments. Remove the Inbox nav item (its `registerPage` or markup) and `#n-questions`. Delete the router's `state.th === 'inbox'` lookup branch.
- [ ] **Step 4:** Run both files. Expected: PASS. Then run `dashboard-threads-sidebar.test.mjs`: expect only its `th=inbox → Inbox page` assertion to fail, which T2 changes.
- [ ] **Step 5:** Commit `kit-100 T1: inbox leaves pages and nav; #inbox and #questions redirect to the panel`. Write the task review record `reviews/task-1.md`.

### Task 2: The Inbox tab, the moved element and the button

**Files:**
- Modify: `index.html`: the `#inbox` section markup → `#th-inbox` in `#th-body`; the `threadsTabs.register` calls; kit-89's pane draw; `.tt` click; kit-89's `th` value check; the `count('n-questions')` and `inboxTitle` writes; a CSS rule for the red count and the column.
- Create: `test/dashboard-inbox-panel.test.mjs` (fixture plus AC1).
- Modify: `test/dashboard-threads-sidebar.test.mjs` (AC1: `th=inbox` now opens the Inbox tab; `threadsTabs.list()` four ids; `.tt` → `th=inbox`, then click the Threads tab where it expected `th=open`), `test/pane-question.answer.test.mjs` (open the panel and pick Threads before reading `#ask-threads`), `test/browser/dev-links.mjs` (click the Threads tab after `.tt`).

**Interfaces:**
- Consumes: T1's table.
- Produces:
  - `inboxCount(): number` (open questions not in `ANSWERED` + `ownerLesson` lessons);
  - the element `#th-inbox`;
  - `th=inbox` accepted by the router;
  - the fixture builder `inboxFixture(base, env)` in the new test file, returning `{ root, Q, P, S, open: [q1, q2, q3], review, lesson, lesson2, answered, defaulted, withdrawn, goal }`.

- [ ] **Step 1: Failing test.** Write `test/dashboard-inbox-panel.test.mjs`, set up as `dashboard-threads-sidebar.test.mjs` is (own `HOME`, ports from `PORTS`, `DEVTEAM_*` removed, `canDrive` skip, `cleanup`). Its fixture is spec §3, built with the kit CLI:
  - `ask` for the questions, `ask --kind review` with the page committed, a candidate lesson `for_owner`;
  - `answer` for the answered question, a past-deadline question let default, `withdraw`;
  - `thread new --subject question:<q1>` for `Q`;
  - `S` with no subject;
  - `P` written as kit-89's tests write a page-subject thread, with `view: '#inbox'`;
  - the terminal prompt faked as kit-89's tests fake it.
  
  Subtest "the tab and the button" asserts AC1 exactly:
  - `threadsTabs.list().map(t=>t.id)` deep-equals `['inbox','threads','supervisor','shell']`;
  - the first tab's text starts "Inbox" and its `.n` equals `open.length + 2` (two owner lessons), with computed colour equal to `--red` resolved;
  - `.tt` click → `location.hash === '#overview?th=inbox'`, `#th-inbox` visible inside `#threads`, `#ask-inbox .ask` present, `#questions [data-qcard]` count `open.length + 1` (with the review), lesson card present, `[data-secret]` present, `#answered-wrap` not `open` with summary `Answered (n)`;
  - `.tt .n.q` text equals the tab's count;
  - the Threads tab → hash ends `th=open` and `#th-inbox.hidden`; the Inbox tab → `th=inbox`;
  - `Page.reload` of `#goals?th=inbox` → Goals shown, panel on Inbox.
- [ ] **Step 2:** Run. Expected: FAIL (no Inbox tab).
- [ ] **Step 3: Implement** spec §2.1–§2.3:
  - move the markup;
  - register Inbox before kit-89's Threads registration;
  - the pane draw sets `#th-inbox.hidden`;
  - the router accepts `inbox` and rewrites `th=inbox` + in-panel `t` to `th=open` (stamped `replaceState`);
  - `.tt` → `thGo({ th: 'inbox' })`;
  - tab select → `thGo({ th: id === 'inbox' ? 'inbox' : 'open' })`, dropping an in-panel `t`;
  - `#inbox-btn-n`, the tab count and `inboxTitle` read `inboxCount()`;
  - CSS: `#th-tabs [data-tab="inbox"] .n { color: var(--red) }`, `#th-inbox { display: flex; flex-direction: column; gap: var(--gap) }`, `#th-inbox .card { margin: 0 }`, `#th-inbox .qcard .why { flex-wrap: wrap }`;
  - remove the `h2`.
- [ ] **Step 4:** Run the new test, `dashboard-threads-sidebar.test.mjs` and `pane-question.answer.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit `kit-100 T2: the Inbox is the panel's first tab`. Write `reviews/task-2.md`.

### Task 3: Every road into the Inbox

**Files:**
- Modify: `index.html`: `openQuestion`, a delegated click handler for `a[href="#inbox"]`, kit-88's `data-answered-go` handler, `leaveReview`.
- Test: `test/dashboard-inbox-panel.test.mjs` (AC2, AC3 first part), `test/dashboard-peek.test.mjs` (the defaulted link: it expects the Inbox tab, not the page).

**Interfaces:**
- Consumes: kit-89's `thGo(next: { th?, t? })`, which pushes or applies `withPage` under a link head.
- Produces: `inboxGo(opts?: { scrollTo?: string })`: `thGo({ th: 'inbox' })`, then, once `#th-inbox` is shown and the target element exists (the next `render()` at most), `el.scrollIntoView({ block: 'center' })` inside `#th-body`.

- [ ] **Step 1: Failing subtests** "the nav and the roads" and "th=inbox". They assert AC2 and AC3's first bullet, plus:
  - from a lesson's peek over Loop, clicking "Keep or retire it in the Inbox" leaves `#drawer` open, `history.state.page === '#loop?th=inbox'`, and the panel on Inbox;
  - a cold load of `#q/<open id>` in a new tab, before `/api/data`, throws nothing (no `Runtime.exceptionThrown`) and ends with `#q-<id>` in `#th-body`'s box;
  - the `redirects` object is found between the `/* shell-routes start */` and `/* shell-routes end */` markers of the file text, after `/* devteam-shell-js end */`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement** spec §2.4:
  - `openQuestion` for an open question: `hideDrawer()`, then replace the `q/` entry with the page head in force plus `th=inbox` (kit-87's `goHead(…, { replace: true })`, cold `#overview?th=inbox`), then `inboxGo({ scrollTo: '#q-' + CSS.escape(id) })`;
  - the delegated handler (capture-free, skips `e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.button`) calls `preventDefault` and `inboxGo()`;
  - `data-answered-go` uses `inboxGo({ scrollTo: '#a-' + id })`, then opens `#answered-wrap` and focuses the Overrule field;
  - `leaveReview` cold → `location.hash = '#overview?th=inbox'`.
- [ ] **Step 4:** Run the new test and `dashboard-peek.test.mjs` (with its defaulted-link assertion changed to: the panel on Inbox, `#answered-wrap[open]`, focus on `input[data-overrule="<id>"]`). Expected: PASS.
- [ ] **Step 5:** Commit `kit-100 T3: every road into the Inbox opens the panel's tab`. Write `reviews/task-3.md`.

### Task 4: Threads whose home is the Inbox

**Files:**
- Modify: `index.html`:
  - `T_HOME`, `tlHome`, `tlOwn`, `tlHitAt`;
  - kit-89's floating-card placement call and its 900px hiding rule;
  - the `#tl` z-index rule;
  - the layer's scroll listener;
  - kit-87's `subjectHead`;
  - kit-89's floating-row rule (keep `th` for an Inbox-home thread).
- Test: `test/dashboard-inbox-panel.test.mjs` (AC3 second part, AC4); a `vm` check of `tlHome`/`T_HOME` in the same file.

**Interfaces:**
- Produces:
  - `inInbox(el: Element | null): boolean`, which is `!!el?.closest('#th-inbox')`;
  - `tlInboxHome(t): boolean`, true for a thread whose subject is an item drawn in `#th-inbox`, or a page subject whose view `parseHead` maps to `state.th === 'inbox'`;
  - `T_HOME.question === 'inbox'`, read by `tlHome` as "look in `#th-inbox`".

- [ ] **Step 1: Failing subtest** "a thread on a question". It asserts AC3's `P` bullet and AC4 exactly, at the sizes named, plus:
  - a cold `#talk/<Q>` in a new tab throws nothing;
  - after `q1` is answered through the API and a redraw passes, no `[data-tl-pin="<Q>"]` is drawn, and `Q`'s row reads " · subject gone".
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement** spec §2.6:
  - `tlHome` looks in `#th-inbox` for `T_HOME[k] === 'inbox'`;
  - `tlOwn` and `tlHitAt` carve out `#th-inbox`;
  - the page rule `#tl { z-index: <above .threads' merged value> }` applies for pins and the card;
  - the placement call clips the rect: `if (inInbox(el)) r = { ...r, left: panelLeft, right: panelLeft }` where `panelLeft = $('threads').getBoundingClientRect().left`;
  - kit-89's ≤900px hide skips cards where `tlInboxHome(t)`;
  - `#th-body` scroll re-places pins (add a listener if the layer's isn't capturing);
  - `subjectHead` returns the page head in force plus `th=inbox` (cold `#overview?th=inbox`) for `tlInboxHome`;
  - the floating-row rule keeps `th=inbox` at every width for `tlInboxHome`;
  - `P` opens with no pin (`tlInboxHome` page subjects draw none);
  - the card waits for the first `render()` before scrolling.
- [ ] **Step 4:** Run the new test, `dashboard-threads-sidebar.test.mjs`, and `dashboard.test.mjs`'s thread-layer subtests (`--test-name-pattern "thread"`). Expected: PASS.
- [ ] **Step 5:** Commit `kit-100 T4: threads on questions live in the Inbox tab`. Write `reviews/task-4.md`.

### Task 5: Typing kept, every control, reviews

**Files:**
- Modify: `index.html`: `holding()`, `render()`'s draft-keeping filters, the `TL.pressed` / `PRESSED` split (kit-89's `#threads` exceptions narrowed to exclude `#th-inbox`).
- Test: `test/dashboard-inbox-panel.test.mjs` (AC5).

**Interfaces:**
- Consumes: T4's `inInbox`.
- Produces: `layerField(el)`, which is `!!el?.closest('#tl, #threads') && !inInbox(el)`. It is used by `holding()` and by the draft filters (`!layerField(el)`, replacing kit-89's `!el.closest('#tl, #threads')`).

- [ ] **Step 1: Failing subtest** "every control from the panel": AC5 in full, each control on its own fixture question.
  - It intercepts `/api/answer`, `/api/knowledge` and the secrets post as `dashboard-owner-action.test.mjs` does (`Fetch.enable` or the server's log), and asserts each request's body: the rule box `rule: true` and the note text.
  - The typing check: type "half a thought" into `q2`'s `textarea[data-q]`, place the caret at 4, then wait for one threads poll and one 10-second `render()` (await `DATA.generated_at` changing). Assert `document.activeElement` is the same textarea, its value is unchanged and `selectionStart === 4`.
  - The review: click `[data-open-review]`; the hash is `#review/<id>`; `#review-view`'s width is greater than `#threads`' width; then close it, and the panel is on Inbox.
- [ ] **Step 2:** Run. Expected: FAIL at least on typing (kit-89's `#threads` exception drops the hold).
- [ ] **Step 3: Implement** spec §2.7 with `layerField`. Make `#review-view` sit above `.threads` (a page z-index rule) if the merged z-order puts it under.
- [ ] **Step 4:** Run the new test and `test/dashboard-answers.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit `kit-100 T5: the Inbox's fields hold redraws in the panel; reviews open full size`. Write `reviews/task-5.md`.

### Task 6: The rest of the suite and the measure

**Files:**
- Modify: `test/dashboard-measure.test.mjs`, `test/dashboard.test.mjs`, `test/next-step.strategy.test.mjs`. If T0's grep lists them, also `test/gateway.test.mjs`, `test/multirepo-views.test.mjs`, `test/ooda-learning.test.mjs`, `test/ooda-lineage.test.mjs`, `test/plain-questions.test.mjs`, `test/fleet-park.test.mjs`, `test/multirepo-landing.test.mjs`, `test/lib/kit.mjs` and `test/lib/chain.mjs`. Navigation-only, if needed: `test/dashboard-answers.test.mjs`, `test/dashboard-owner-action.test.mjs`.

- [ ] **Step 1: The measure entry.** Remove kit-87's `#inbox` page entry. Add `{ hash: '#overview?th=inbox', ready, opts }` on a second project seeded with T2's fixture builder (as kit-88 and kit-89 did, so earlier entries keep their data):
  - `opts: { inbox: '#no-such-button' }`, plus kit-87's `view` override for Overview if Overview is still unported at merge;
  - `ready` is true once `#th-inbox [data-qcard]` exists. It sets `#answered-wrap.open = true`, then sets `const b = $('th-body'); b.style.width = getComputedStyle(b).width; b.style.overflowY = 'visible'`, so the measured width includes the scrollbar's loss (spec AC6);
  - a fixture string, a 120-character unbroken link, in one choice's detail (Review Focus 5).
  
  `localStorage.removeItem('devteam.threads.open')` runs before it, as kit-89's entries do.
- [ ] **Step 2:** Run `dashboard-measure.test.mjs`. Fix layout (never the checks) until PASS at all three sizes.
- [ ] **Step 3: Migrate.** For each file in T0's list: replace navigation to `#inbox` or reads under `main #inbox` with opening the panel (`location.hash = '#overview?th=inbox'`, or the redirect left as is where it works) and reads under `#th-inbox`, assertions unchanged.
  - `next-step.strategy.test.mjs`: delete the `#inbox h2 .sub` assertion (the interim this ticket ends: the heading goes). Its `#questions > .card` reads stay.
  - `dashboard.test.mjs`'s `main #inbox` reads become `#th-inbox`.
- [ ] **Step 4:** Run each migrated file, one at a time. Expected: PASS.
- [ ] **Step 5:** Commit `kit-100 T6: the suite reads the Inbox in the panel; the measure judges it`. Write `reviews/task-6.md`.

### Task 7: The `/view/` tab

**Files:**
- Modify: `index.html`: the Inbox tab's `render` and `count` under `VIEWER`.
- Test: `test/dashboard-inbox-panel.test.mjs`.

- [ ] **Step 1: Failing subtest** "/view/". At `/view/artifact/<slug>`:
  - click `#tt-peek` → the panel opens on Inbox;
  - `#th-pane` holds one link with text "Answer questions on the dashboard." and `href` `/#overview?th=inbox`;
  - the tab's count equals hello's `inbox`;
  - `/api/data` is never requested.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Under `VIEWER`:
  - the Inbox tab's `render(el)` writes `<p><a class="linkish" href="/#overview?th=inbox">Answer questions on the dashboard.</a></p>`;
  - `count()` returns hello's `inbox` (the value `thDraw()` already reads), or `null`;
  - `#th-inbox` stays hidden there (no data);
  - the `/view/` button opens on `TH.th = 'inbox'`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `kit-100 T7: the /view/ tab's Inbox points to the dashboard`. Write `reviews/task-7.md`.

### Verification and finish

- [ ] **`verification.md`:** one row per done-when, with the exact command and its result at a named commit, CI run links included. Then the inventory checklist (spec AC7), each item with the subtest or the screenshot that shows it. Screenshots go in `project/tickets/kit-100-inbox-in-panel/shots/`: light and dark, 1440 and 390, the panel on Inbox.
- [ ] **Finish:** follow worker.md §8: merge `origin/main`, push, the PR, `reviews/final-1.md` from a fresh reviewer, `check-ticket`, then `merge-request`.
