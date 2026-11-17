# kit-90 Overview and Goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- Five tasks, all in `docs/devteam/dashboard/index.html` outside the two frozen shell blocks, plus one new test file and the measure list.
- T1 `goalBlock` (full / partial / null) as a pure `vm`-tested marker block, with the muted red and amber outlines.
- T2 Goals: `tabBar` tabs in `gt`, two-across cards on the shell's `goalSteps` (via one adapter, `goalStepData`), Upkeep's `heartbeat` card, no hold/Open/Strategy/retro.
- T3 Overview: header with `statusPill`, ruled sections (Status, ten Numbers, the Autonomy row of four scores with 12-week lines, Goals rows, Needs you with the Next chip, Commit history).
- T4 the goal peek (properties in the done-when's order, Hold with Let go/Restore, the impact form) and Upkeep's peek, both from a `goal-peek` marker block; the Inbox tab's Next chip.
- T5 the measure list, the existing tests moved to the new markup, gates and the inventory check.
- Build starts only after `kit-100`, `kit-98`, `kit-173` and `kit-242` merge and `approve-plan` is recorded; every line number below is re-read then, since `kit-87`…`kit-100` rewrite the page around these parts.

**Goal:** Overview and Goals on the shell's 12-column grid as the owner's mock shows them, with the shared step bar, blocked-goal outlines, the goal and Upkeep peeks, and the Next chip.

**Architecture:** Page code only. Pure logic (`goalBlock`, `goalStepData`, the peek section list) sits in marker blocks the tests run in `vm`; the drawing calls the frozen shell builders (`goalSteps`, `heartbeat`, `statusPill`, `tabBar`, `props`). A real dashboard on a `bareProject` drives the Chrome tests; fields the kit can't produce in a fixture (`upkeep_days` days, the four scores, `pulse`) are patched into `/api/data` and `/api/hello` responses by the test's init script.

**Tech Stack:** vanilla JS/CSS in `index.html`; `node:test`, `node:vm`, `test/lib/chrome.mjs` (headless Chrome), `test/lib/measure.mjs`.

**Spec:** `docs/devteam-dev/tickets/kit-90-overview-goals/spec.md`; design `project/designs/a-cleaner-more-consistent-dashboard.md` (home); mock `project/artifacts/dashboard-cleanup/index.html` (home).

## Global Constraints

- Neither shell block (`devteam-layout` CSS, `devteam-shell-js`) changes by a byte; `test/dashboard-shell.test.mjs` passes untouched.
- Files only from the ticket's touches; records under `docs/devteam-dev/tickets/kit-90-overview-goals/`.
- Running text at most `--measure`; card-head actions at the right edge; nothing wider than its parent; side-by-side cards equal height; first content at `--page-top`.
- Blocked outlines exactly: full `color-mix(in srgb, var(--red) 45%, var(--line))`, partial `color-mix(in srgb, var(--amber) 55%, var(--line))`; unblocked Overview rows `1px solid var(--line)`.
- Steps are the block's words: Defining, Planning, Waiting on you, Built, Met (following state); done `--series-1`, current amber.
- Tests run one file at a time at `--test-concurrency=2`, through `devteam.mjs gate`; never the full suite on the box. CI is the gate.
- Any probe or subagent: scripts in files, private `mktemp -d`, guarded `rm -rf "${S:?}/x"`, `timeout` on everything, `</dev/null` never `/dev/zero`, no background or interactive clients, no `prlimit --as`/`ulimit -v` on node; kit commands outside tests with their own HOME, `DEVTEAM_HUB_PORT` away from 4320, every `DEVTEAM_*` unset; never judge a run through a pipe (k-20261115-182656232, k-20261115-080753394, k-20261115-164245020).

## Review Focus

1. A goal with no features yet but a planner stopped at a prompt: fully blocked (one unit, stuck), not null. Test in T1.
2. A question that blocks a ticket of another goal must not mark this goal: `goalBlock` matches tickets by the goal's own features only. Test in T1.
3. Goals' tab survives the 10-second redraw (the tab comes from the hash, not DOM state) and a filter-less Back. Test in T2 (wait past one poll, tab still Met).
4. Overview with zero goals and zero questions: "None" in both sections and no Next chip anywhere. Test in T3.
5. Let go's confirm survives a redraw inside the peek (today's `OA_CONFIRM`/hold confirm state is page memory, not DOM). Test in T4 (wait a poll between Let go and Confirm let go).

---

### Task 1: `goalBlock` and the blocked outlines

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (new `/* goal-block start */ … /* goal-block end */` marker block beside `goalState`; CSS `.blk-full`, `.blk-partial` in the page's own style)
- Create: `test/dashboard-overview-goals.test.mjs` (its `vm` part)

**Interfaces:**
- Produces: `goalBlock(goal, data) -> 'full' | 'partial' | null`, where `data` is `/api/data` (`ooda.roadmap`, `tickets`, `questions`, `planners`). Uses no globals but its arguments.
- Produces: CSS classes `blk-full`, `blk-partial` for `.card.goal` and `.ov-goal`.

- [ ] **Step 1: Write the failing tests** — `test('goalBlock: full, partial and null', …)`: slice the marker block out of `index.html` (as `dashboard-shell.test.mjs` slices its block) and run it in `vm`. Fixture: goal `g1` with feature `f1` (roadmap `goals[{id:'g1',features:['f1']}]`, `features.f1`), tickets `a`, `b` on `f1`. Assert:
  - `questions=[{id:'q-1',status:'open'}]`, `a.held_by='q-1'`, `b.phase='blocked'` → `'full'`;
  - `a.held_by='q-2'` where `q-2` has a `default`, `b` moving → `null`;
  - `a.held_by='q-1'` (open, no default), `b.depends_on=['a']` (direct) → `'full'`;
  - `a.held={…}`, `b` building → `'partial'`;
  - an open question with `blocks:['b']` and `a` merged → `'full'`;
  - no feature, planner `{goals:['g1'], waiting:{kind:'prompt'}}` → `'full'`; that planner plus a moving ticket → `'partial'`;
  - nothing waiting → `null`; no work → `null`; `status:'met'` or `'abandoned'` → `null`;
  - a question blocking ticket `z` of feature `f2` (another goal's) → `null` for `g1`;
  - `a.held_by='q-1'`, `b.depends_on=['c']`, `c.depends_on=['a']` (two levels down) → `'full'`;
  - an open question with a `default` blocking `a`, `b` moving → `null`;
  - planner `waiting:{kind:'limit'}` only, no tickets → `null`;
  - the goal's `hold_view.mode` `'park'` with every ticket waiting → `null`.
- [ ] **Step 2: Run** `node docs/devteam/scripts/devteam.mjs gate test -- node --test --test-concurrency=2 test/dashboard-overview-goals.test.mjs`; expected FAIL (no `goal-block` block).
- [ ] **Step 3: Implement `goalBlock`** in the marker block: `null` for met, abandoned, or `hold_view.mode` `park`/`let-go`; work = unmerged tickets (stage not `merged`, `released`, `superseded`) on the goal's roadmap features, plus planners naming it; a ticket is stuck if `held_by` names an open question in `data.questions` with no `default`, or `held` or `phase === 'blocked'` or an open question with no `default` names it in `blocks`/`ticket`, then grow the stuck set over `depends_on` until it stops changing (as `helloPulse` does); a planner is stuck if `waiting` and `waiting.kind !== 'limit'`. Add the two CSS rules from Global Constraints.
- [ ] **Step 4: Run** the same gate; expected PASS.
- [ ] **Step 5: Commit** `kit-90: T1 goalBlock and the blocked outlines`; write `reviews/task-1.md` from a fresh subagent reviewer; commit it.

### Task 2: Goals page

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (the Goals page's render as registered by `kit-87`; `goalCard`, `upkeepCard`, `goalStepper` removed in favour of `goalStepData`; a closed-goal card)
- Test: `test/dashboard-overview-goals.test.mjs` (Chrome part; shared setup below)

**Interfaces:**
- Consumes: `goalBlock` (T1); shell `goalSteps`, `heartbeat`, `tabBar`, `bindTabBar`; `kit-87`'s page registration and hash routing with the `gt` key.
- Produces: `goalStepData(g, s, R) -> { step, built, met } | null` (null for a let-go goal), used by T3 and T4. `heartbeatDays(days) -> [{ day, items, failed }]` from `kit-84`'s `[{ starts_at, items: [{ kind, ref, words, at }], failed }]` (`day = starts_at.slice(0, 10)`, `items = items.map((i) => i.words)`), used by T4. `goalCardHtml(g, R, openQs)`, `upkeepCardHtml(u, days)`.
- Consumes from `kit-87`/`kit-88` (names from their plans; re-read at build): `registerPage`/`showPage`, `cardHead(…, { open })`, `cardMenu`, `data-open="goal/<id>"` on goal cards, `psect(title, html)`, `howItChanges(kind, rec)`.

- [ ] **Step 1: Shared Chrome setup** in the test file: `bareProject(base,'overview-goals')`, env as in `dashboard-measure.test.mjs` (own HOME, `DEVTEAM_HUB_PORT=PORTS+N` with an unused N, every `DEVTEAM_*` unset); seed via `devteam.mjs` as supervisor where a command exists (`goal add`, `goal approve`/status ready, `ticket add`, `ask`, `goal reading` for g3's numeric measure reaching its target, `correct --impact` or the goal-impact decision for g1's impact, since the impact form draws only when `g.impact` exists), and append log lines with `line()` from `test/lib/kit.mjs` where none does (a worker `phase` line `to: 'blocked'`, a ticket `held` update), checking `/api/data` shows each before the browser opens: goals g0 (draft being defined, for the step words), g1 (ready, one feature, two tickets: one `phase blocked`, one held → full), g2 (ready, one ticket blocked, one moving → partial), g3 (ready, at target, nothing waiting), g4 (met), g5 (let go), g6 (a design waiting on the owner's approval: an open goal-approval question); two open questions. An init script (as `dashboard-owner-action.test.mjs`) speeds the 10 s poll to 300 ms, records POSTs, and merges `window.__patchData` into `/api/data` and `window.__patchHello` into `/api/hello` (`upkeep_days` fixture of 14 days in `kit-84`'s shape `{ starts_at, items: [{ kind, ref, words, at }], failed }`, with one busy, one failed, one quiet; a vm case checks `heartbeatDays` maps it to `{ day: 'YYYY-MM-DD', items: [words], failed }`; `pulse: { state: 'waiting', activity: [...] }`).
- [ ] **Step 2: Write the failing tests** — `test('goals: tabs, two across, cards and Upkeep', …)`: at 1440×900 `#goals`: tab names and counts `Active 6` (g0, g1, g2, g3, g6 + Upkeep), `Met 1`, `Let go 1`; each `.card.goal` width ≈ half the grid (two per row, equal `offsetHeight` per row); g1 card has `blk-full`, g2 `blk-partial`, g3 neither; cards contain `ol.steps`, `.goal-next`, `Read the design` link, Mark met only on g3; no `[data-hold-id]` (Upkeep's card included), no link text `Open` or `Strategy`, no retro badge, no Goals heading sub-line; `#unassigned` present under the cards; Upkeep's head extra reads `always on`; Upkeep card has `.heartbeat` with 14 cells, last titled with today's items, failed cell `.bad`, quiet cell no `l1`–`l4`, and no `ol.steps`; each card's `ol.steps` `outerHTML` equals `goalSteps(goalStepData(...))` evaluated in the page, for g0 (Defining now), g2 (Building now, `Defined`/`Planned`/`Approved` done) and g3 (Met? now) and g6 (`Waiting on you`); Built and Met carry their `.step-sub` lines on g3. Then click Met → hash `#goals?gt=met`, Met cards shown; wait 1 s (three polls), still Met; `history.back()` → Active; navigate `#goals?gt=letgo`, reload → Let go selected. Done step computed colour equals `--series-1`, the `now` step amber. `test('the shell blocks are untouched', …)`: `index.html`'s `devteam-layout` and `devteam-shell-js` blocks equal `hub.html`'s byte for byte.
- [ ] **Step 3: Run** the gate; expected FAIL.
- [ ] **Step 4: Implement** the Goals render per spec §3: `tabBar` (ids `active`, `met`, `letgo`), selection assigns `location.hash` (`#goals` / `#goals?gt=<id>`); `.g12` of `.c6` cards; Upkeep first; card per spec (keep today's head, title, steps, next, links, attestation, Mark met; drop hold control, Open, Strategy, retro badge, Upkeep's paragraph and hold); `#unassigned` and the no-goals empty state kept; `blk-<goalBlock>` class; closed cards; "None". Move every `goalStepper` caller to `goalSteps(goalStepData(...))` and delete `goalStepper`.
- [ ] **Step 5: Run** the gate; expected PASS.
- [ ] **Step 6: Commit** `kit-90: T2 Goals`; `reviews/task-2.md`; commit.

### Task 3: Overview

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (the Overview page's render; the `stats` array moves into it; `.ov-goal`, `.chip-next`, `.ov-pill`, `.sparkline`, mosaic CSS in page style)
- Test: `test/dashboard-overview-goals.test.mjs`

**Interfaces:**
- Consumes: `goalStepData`, `goalBlock`; shell `statusPill`, `.ov-head`, `.sec`, `.rows`, `.rowline`, `.dot`; `/api/hello`'s `pulse`.
- Produces: the `/* score-of start */ … /* score-of end */` marker block with `SCORE_TILES` (`[['autonomy score','autonomy_score','this_week'],['trust score','autonomy.decisions','score.this_week'],['efficiency score','efficiency','score.this_week'],['awareness score','awareness','score.this_week']]`, label → dotted path → dotted place of its %) and `scoreOf(rec, at = 'score.this_week') -> { pct, weeks }`, `vm`-tested: `scoreOf({score: {this_week: 71.6, last_week: 70}, weeks: [12 × {score}]})` → `{pct: 72, weeks: [12 numbers]}`; `scoreOf({this_week: 71.6, last_week: 70, weeks: [12 × {score}]}, 'this_week')` → `pct: 72`; a record whose value at `at` isn't a number (`autonomy.decisions`-like `{this_week: {…}}` read at `'this_week'`) → `pct: null`, never NaN; a null week's `score`, and a week record with no `score`, stay null in `weeks`; `undefined`, `null`, `{}`, `{score: {this_week: null}}` → `pct: null`; `{score: {this_week: 50}}` (no `weeks`) and `{score: {this_week: 50}, weeks: 'x'}` → `{pct: 50, weeks: []}`; more than 12 weeks keeps the last 12; `SCORE_TILES` resolved on a `/api/data`-shaped object reads `autonomy.decisions`, not `autonomy`, and `autonomy_score`'s `this_week`; the line is the page's `spark(v, label)` (`kit-174`'s, reused, not redefined; a vm case pins that a mid-series null breaks its `d` into two runs at their own weeks' x); one more `vm` case loads `test/fixtures/g1/dashboard-data.txt` (the G1 golden of `/api/data`) and, at each of the four paths, whether or not it is scored, asserts the shape: the value is a non-null object; its % place resolves to an own property that is a number or null; `weeks` is an array of 12 items, each with an own `score`; `scoreOf(rec, at).weeks` equals those 12 scores and `.pct` the rounded value at its place (so a renamed, moved or reshaped field fails even when unscored); `.chip-next` (T4 uses it on the Inbox card); `NEXT_ID()` returning `DATA.questions[0]?.id ?? null`.

- [ ] **Step 1: Write the failing tests** — `test('overview: header, sections, numbers, goals, needs you', …)`: `.ov-head h2` is the project name, `.sum` matches `/\d+ questions? · \d+ tickets? in flight/`, the last child is `statusPill('waiting')`'s output and its right edge meets the header's; `.sec .lbl` texts are `Status, Numbers, Autonomy, Goals, Needs you, Commit history` with `font-family` monospace; Numbers' tile labels are the mock's order, 9 without a production sensor (no Bugs merged) and, after patching `sensors` with one production sensor, 10 with `Bugs merged` last, titled with the hover text, and no label in Numbers contains `score`; the header pill is `unknown` while `/api/hello` is made to fail (init script) and `waiting` after; the Supervisor row reads `stopped at a prompt` with `/api/threads`' `supervisor.question` patched to a dialog, `at a usage limit` with `kind: 'limit'`, and the green last-moved line with none; Workers reads `<active> of <max_active_tickets>`, Planners its count, Sensors `<up> of <total>`; each Overview goal row's `ol.steps` `outerHTML` equals Goals' card's for the same goal; the Autonomy row's labels are `autonomy score, trust score, efficiency score, awareness score`, each `c3`, all four `–` with no `svg.sparkline` with the four fields patched to null, then, first, unpatched, each tile's text equals what the served `/api/data` holds at its `SCORE_TILES` path (`n%` of the value at its `SCORE_TILES` place, or `–` for null), so a wrong path fails; then, with records patched in at `autonomy_score`, `autonomy.decisions`, `efficiency`, `awareness` in the data tickets' shapes (`{score: {this_week, last_week}, weeks: [12 × {score}]}`, and `autonomy_score` as `{this_week, last_week, weeks: [12 × {score}]}`: this weeks 70, 81, 62, 55 in that order and distinct weeks per field, so a swapped field shows), each exactly its `70%`, `81%`, `62%`, `55%` and an `svg.sparkline` whose `path` `d` equals the page's `spark(weeks, label)`'s for its own field's weeks (one run of 12) and whose `aria-label` is `<label>, the last 12 weeks`; a record with weeks 3–8 null shows its % and a `path` of two runs whose points sit at weeks 0–2 and 9–11's x (x = 1 + i·78/11, computed in the test), not spread across the width and not bridged; a field with one scored week shows its % and no `svg.sparkline`; with only `autonomy.decisions` patched (the rest null), Trust shows its % and the other three stay `–`; Autonomy Score's `title` is the mean hover (ruling `m-20261115-204822283-supervisor`); goal rows are g0–g3 and g6, each `border-top-width` 1px, g3's colour equals `--line`, g1's and g2's the muted red/amber; rows side by side have equal heights; Needs you lists both questions in `DATA.questions` order with `.chip-next` on the first only; Commit history has a mosaic spanning the section's body width with 12 columns for the 84 days, and no caption. A second project with no goals and no questions shows "None" in Goals and Needs you and no `.chip-next` in the page.
- [ ] **Step 2: Run** the gate; expected FAIL.
- [ ] **Step 3: Implement** spec §1: `HELLO` fetched from `/api/hello` on load and with each redraw (failure keeps the last, or null); header `statusPill(HELLO?.pulse?.state ?? 'unknown')`; Status rows (Supervisor from `TL`'s `supervisor.question` as `askSet` keeps it, else `HELLO.pulse.last_activity`); the down banner kept above; `sec(label, body)` helper; the ten tiles in the mock's order (`done, forecast finish, workers active, blocked, median cycle, cost per ticket, spend, open questions, answer rate (14d), bugs merged`), Bugs merged only when `sensors` has a production sensor, with an info icon and the mock's tooltip "A production error traced to a merged change, or one you reported. Shown once the project has a production sensor."; the Autonomy section after Numbers: four `.c3 stat` tiles, one per `SCORE_TILES` row, from `scoreOf` of the record at its path (the merged data tickets' code read first; a different path or shape changes the table and is told to the supervisor), each `n%` else `–`, and the page's `spark(weeks, label)` (`kit-174`'s, reused) when two scored weeks or more; Autonomy Score's hover and info icon; goal rows `a.c6.ov-goal` (`href="#goal/<id>"`) for every active goal, with badge, title, steps, `blk-*`; Needs you rows linking to each question (the shell's open-question link to the Inbox tab); the mosaic from `pulse.activity` (weeks as columns, 7 rows, full width; the 84 days hello gives, ruling `m-20261115-204822283-supervisor`).
- [ ] **Step 4: Run** the gate; expected PASS.
- [ ] **Step 5: Commit** `kit-90: T3 Overview`; `reviews/task-3.md`; commit.

### Task 4: Goal and Upkeep peeks, and the Inbox's Next chip

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (`openGoal` as `kit-88` left it; new `/* goal-peek start */ … /* goal-peek end */` marker block; the Inbox tab's first card)
- Test: `test/dashboard-overview-goals.test.mjs`

**Interfaces:**
- Consumes: `goalStepData`, `holdControl`, `impactBlock`, `kit-88`'s peek frame and section-card helper, shell `props`, `heartbeat`.
- Produces: `GOAL_PEEK = { goal: [...ids], upkeep: [...ids] }` and `GOAL_PEEK_SECTIONS = { [id]: (g, ctx) => html }` (ids: `steps`, then `kit-88`'s goal section ids in its order; upkeep: `heartbeat`, `chores`). recurring-upkeep appends to `GOAL_PEEK.upkeep` and `GOAL_PEEK_SECTIONS` only.

- [ ] **Step 1: Write the failing tests** — `test('goal peek and Upkeep peek', …)`: open `#goal/<g1>`: property keys in order start `ID, Status, Hold, Priority, Why it matters, Milestones, Measured by, Opened, How it changes` (contiguous); section card headings follow `GOAL_PEEK.goal` (read from the page) with the step bar first (its `ol.steps` equal to the goal's card's) and History last; How it changes keeps `kit-88`'s Start a thread button (`data-thread-on`); Hold shows Run, Drain, Park, Let go; click Let go → reads `Confirm let go`, wait 1 s, still `Confirm let go`, click → a POST with the hold body as today's; `#goal/<g5>` shows only `Restore (parked)`; g1's Why it matters: click Wrong?/Change it, pick 2, type a reason, submit → POST body `{ action: 'correct', body: { id, reason, impact: 2 } }`; `#ticket/<id>` and `#goal/upkeep` have no `select[data-impact]`. `#goal/upkeep` (patched held with a reason): keys `ID, Status, Hold, Held because, What it covers, Chores in flight, How it changes`, Hold without Let go, sections `GOAL_PEEK.upkeep` with the heartbeat and the day items. `test('the Next chip', …)`: open the panel's Inbox tab (`#overview?th=inbox`): exactly two `.chip-next` in the document (first question card, first Needs you row), the card's other parts (choices, textarea, Answer, Reply, Can't right now) as before, and the card's width equals the panel body's.
- [ ] **Step 2: Run** the gate; expected FAIL.
- [ ] **Step 3: Implement** spec §5 and §6: the properties in that order (Hold = `holdControl(g.id, g.hold_view, {status, restoring})`; Why it matters = `impactBlock(g)`; How it changes = `kit-88`'s `howItChanges('goal', g)` row moved into this order), then `GOAL_PEEK.goal.map(id => GOAL_PEEK_SECTIONS[id](g, ctx))`, History last; Upkeep's peek on `#goal/upkeep` from `DATA.upkeep` and `upkeep_days` with `holdControl('upkeep', u, { letGo: false })`; the `.chip-next` on the Inbox tab's card whose id is `NEXT_ID()`.
- [ ] **Step 4: Run** the gate; then, one file at a time through the gate, `test/dashboard.test.mjs` and `kit-88`'s `test/dashboard-peek.test.mjs` (outside the touches: a break there is a `design-change` message to the supervisor, not an edit); expected PASS.
- [ ] **Step 5: Commit** `kit-90: T4 goal and Upkeep peeks, the Next chip`; `reviews/task-4.md`; commit.

### Task 5: Measure list, the moved tests, verification

**Files:**
- Modify: `test/dashboard-measure.test.mjs` (`PAGES`), and only where they assert today's Overview/Goals markup: `test/dashboard.test.mjs`, `test/plain-questions.test.mjs`, `test/ooda-learning.test.mjs`, `test/ooda-lineage.test.mjs`, `test/multirepo-views.test.mjs`, `test/multirepo-landing.test.mjs`, `test/fleet-park.test.mjs`, `test/gateway.test.mjs`, `test/lib/kit.mjs`, `test/lib/chain.mjs`
- Create: `docs/devteam-dev/tickets/kit-90-overview-goals/verification.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1:** Add to `PAGES`: `#overview`, `#goals`, `#goals?gt=met`, `#goals?gt=letgo`, `#goal/<id>` (a seeded goal; the measure project gains one via `devteam.mjs goal` before measuring), `#goal/upkeep`, and `#overview?th=inbox` only if `kit-100` hasn't already listed it, each with `ready` waiting for its content.
- [ ] **Step 2: Run** `gate test -- node --test --test-concurrency=2 test/dashboard-measure.test.mjs`; fix page CSS (never the blocks) until every size passes.
- [ ] **Step 3:** `grep -l` the listed tests for `#stats`, `goal-`, `goalStepper`, `data-hold-id`, `strategy-link`, `escaped defects`, `#goals-list`; run each hit file alone through the gate; update its assertions to the new markup with the same intent.
- [ ] **Step 4:** Push; confirm the CI run's conclusion with `gh run view` (never a log excerpt); write `verification.md` (a row per done-when: command, result, commit; the inventory check as deferred to the final review) and commit.
- [ ] **Step 5:** Merge `origin/main`, re-run the touched files, PR, final review, `check-ticket`, `merge-request` (worker.md §8).

## Rulings

- `m-20261115-203802903-supervisor`: plan ahead; build after deps and `approve-plan`; touched files only at `--test-concurrency=2`; briefs carry k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and scripts-in-files.
- Asked `m-20261115-210051001-kit-90-overview-goals`: amend done-when 1's "a year of weeks" to the ruled 84 days.
- `m-20261115-204822283-supervisor` (answering `m-20261115-204531086` and `m-20261115-204605295`): (1) both score tiles read /api/data's fields when present and show '–' when absent, tested both ways, with no dependency on kit-98 or kit-173; (2) Commit history draws hello's 84 days at full width now; devteam.mjs stays out of the touches, and a year of weeks is a later data change.
- `m-20261115-210347780-supervisor`: done-when 1 says the weeks hello's `pulse.activity` holds (84 days today), full width, no caption.
- `m-20261115-210557189-supervisor`: approve-spec and approve-plan at 915c3bd; build once `kit-100` merges.
- `m-20261115-214239909-supervisor`: review rounds capped; after a second round Minor findings are fixed and disposed with no further pass.
- `m-20261115-234500335-supervisor`: done-when changed: Numbers back to ten tiles, then the Autonomy row of four scores with 12-week lines; amend, one combined re-review of the delta, re-approval.
- `m-20261115-235051446-supervisor`: re-approved spec and plan at 117800a.
- `m-20261116-000030161-supervisor` (graph-20): also wait on `kit-242`; draw the Autonomy row from the data tickets' shape; Bugs merged inside Numbers; one delta review, then re-approval.
- `m-20261116-000703166-supervisor`: re-approved spec and plan at d7e00ec, no extra pass; the first task review (reviews/task-1.md) confirms delta-3's F1 explicitly (the shape check at the four score paths against the G1 golden), and every task review brief names it until it is confirmed.
- `m-20261117-144551912-supervisor`: no delta review for e7d4c79 (autonomy_score's % at `this_week`; `kit-174`'s `spark` reused): both were allowed; verification.md names both for the final reviewer.
