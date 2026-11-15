# kit-174: the Efficiency page — implementation plan

## TL;DR

- One new page in `docs/devteam/dashboard/index.html`, `efficiency`, registered in the Autonomy group right after Trust, drawn as one Efficiency Score card in Trust's ruled sections: Score, Where it goes, Waste, Suggestions. It only formats `/api/data` `efficiency` (kit-173) and `metrics.cost`; it computes nothing.
- Sensors › Fleet loses Hours by phase, USD by phase, USD by model and Tokens; they move to Where it goes, with the source line and unpriced models. Findings, Set aside and the checks stay.
- Suggestions start a thread on a page subject, `{kind:'page', view:'#efficiency?suggestion=<id>'}`, which the kit already accepts; a click opens the open thread on that view if there is one (found in the page's thread list), else a draft, and writes nothing itself. No kit-99, kit-93 or devteam.mjs change: the chart helpers and suggestions list are ported from the mock into index.html, for kit-93 and kit-99 to reuse.
- Order: test fixture and harness first, then the page shell with Where it goes and the Fleet move, then the Score section's charts, then Waste and Suggestions, then the measure test.
- Tested in headless Chrome by a new `test/dashboard-efficiency.test.mjs` over a real dashboard with `/api/data` rewritten in the page to a known fixture (null weeks, a defect week, a null-id waste item, an unknown suggestion kind), and by `dashboard-measure.test.mjs` with Efficiency added at three sizes.
- Risk: index.html will have been reshaped by kit-87 before this builds, so Task 1 starts by re-anchoring the names below against kit-87's shell; NaN or out-of-plot SVG from null data, which the tests assert against; a page view with a query, which today's thread placement doesn't parse (Task 4 teaches it).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** draw the Efficiency page beside Trust from kit-173's data and move Health's spend cards onto it.

**Architecture:** one `registerPage` call and a render function `renderEfficiency(d)` in index.html, built in the shell's `.sec g12` sections with chart helpers ported from the mock (`scoreLine`, `spark`, `fitCharts`, `suggestionsList`), placed outside the shared blocks so kit-93 and kit-99 can reuse them for Trust. Tests drive real Chrome against a bare-project dashboard and replace `/api/data`'s body in the page.

**Tech Stack:** plain browser JS and CSS in one HTML file; `node:test`, `test/lib/chrome.mjs`, `test/lib/measure.mjs`.

**Spec:** `docs/devteam-dev/tickets/kit-174-efficiency-page/spec.md` (approved text at `5fefef2`), as changed by rulings `m-20261115-210456802-supervisor` and `m-20261115-210500882-supervisor` (below): wherever the spec says a suggestion's thread is on `{"kind":"item","ref":"suggestion:<id>"}` or that kit-99's list and handler are reused, read the page subject and the ported helpers of this plan; the ticket's done_when 3 says so.

## Global Constraints

- Every file changed is in the ticket's touches: `docs/devteam/dashboard/index.html`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-measure.test.mjs`, `test/lib/kit.mjs` (others in touches only if a merge from main makes them need a line).
- No change to the `devteam-layout` CSS block or the `devteam-shell-js` block (shell.md@1 frozen until kit-95); no change to `shell.md`.
- No kind id or raw suggestion kind in owner-facing words (strategy R2); phase and model keys are shown as the kit's own labels.
- Running text within `--measure`; nothing sticks out of its parent at 1440x900, 720x800, 390x844.
- Null in any weekly field is a gap in a chart and "–" in a number; the score axis is 0 to 100.
- Tests run on the box one file at a time: `node '/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs' gate test -- node --test --test-concurrency=2 <file>`, never the full suite; judge by the gate's exit code, never a piped excerpt.
- Any probe dashboard outside tests: own HOME (`mktemp -d`), `DEVTEAM_HUB_PORT` away from 4320, own port, `DEVTEAM_*` unset.

## Anchors (re-checked in Task 1, step 1)

kit-87 lands before this ticket; kit-93, kit-97 and kit-99 land after it. Task 1 step 1 greps the merged index.html for each row and records the actual names in `reviews/task-1.md`'s opening paragraph; later tasks use the recorded names.

| Purpose | Name | Where it comes from |
|---|---|---|
| page registry | `registerPage` (shell.md@1) | kit-83 / kit-87 |
| card head | today's `cardHead(icon, title, opts)` (or kit-87's) | the kit |
| ruled sections | `.sec g12`, `.c3 lbl`, `.c9`, `.rows`, `.rowline` | the layout block (kit-83) |
| the score's 12-week line | `scoreLine(values, W, { min, max })` | **ported** from the mock's `scoreLine` (index.html of the mock ~942), with nulls as gaps and a `{ min: 0, max: 100 }` axis added |
| sparkline | `spark(values, label)` | **ported** from the mock's `spark` (~939), nulls as gaps |
| chart refit | `fitCharts()` over `.fit[data-fit]` | **ported** from the mock (~962), with a draw function registered per `data-fit` key instead of the mock's `if` chain, so kit-93 can add Trust's keys |
| suggestions list | `suggestionsList(items, { title })` | **ported** from the mock (~973), each item `data-sugg="<id>"`, `tabindex=0`, `role=link`, no buttons |
| bars | today's `bars(el, obj, fmt, empty)` (Health's) | the kit |
| threads | `tlStart(hit)` (opens a draft), `tlOpen(id)`, `TL.threads`, `tlHome(s)`, `tWhere(s)`, `tKey(s)` | the kit (~5127, ~5497, ~5137, ~4916, ~4926) |

The ported helpers sit in index.html's page script outside the `devteam-shell-js` block, named as above; the review request names them so the supervisor can tell kit-93 and kit-99. If any kit name differs, or a needed change falls outside touches, stop and send the supervisor a `design-change` message.

## Review Focus

1. A server without `efficiency` (an older kit, a hub showing an older project): the page must draw, Where it goes from `metrics`, no throw — Task 2 test `efficiency missing`.
2. The G1-like empty data (12 weeks, all zeros and nulls, `best: null`): no NaN in SVG, "–" everywhere — Task 3 test `all weeks unscored`.
3. Long phase and model names at 390px: labels truncate, nothing overflows — covered by Task 5's measure at 390 with a fixture model name of 60 characters.
4. The 10-second redraw with a thread open on a suggestion: the pin stays, focus isn't stolen — Task 4 test `redraw keeps the suggestion thread`.
5. A suggestion id with characters a selector or a URL query would choke on (kit-173 dash-folds, but the page must not rely on it): the view carries `encodeURIComponent(id)`, the lookup decodes it and selects through `CSS.escape` — Task 4 test `where a suggestion's thread lives` with `eff-cache-a.b:c&x=1`.

---

### Task 1: the fixture, the in-page data rewrite, and anchors

**Files:**
- Modify: `test/lib/kit.mjs` (append)
- Create: `test/dashboard-efficiency.test.mjs` (scaffold: one test that loads `#efficiency` with the fixture and asserts the rewrite took)

**Interfaces:**
- Produces: `export function efficiencyFixture({ defect = true, efficiency = true, source = 'measured', suggestions, waste, weeks } = {})` → `{ efficiency, metrics, threads }` (`efficiency` null when `efficiency: false`; `suggestions`, `waste`, `weeks` override the defaults, for the empty and all-unscored cases) where `metrics` is a partial `{ phase_hours, phase_usd, cost: { source, tokens, by_model, unpriced_models } }` to merge into `/api/data`'s `metrics`, and `threads` (default `[]`) is a list of thread objects to add to `/api/threads`' answer (the shape `/api/threads` returns at the head, copied from an existing threads test fixture, e.g. `threadsFixture` in `test/lib/kit.mjs`); and `export function dataRewriteInit(fx)` → a string script for `Page.addScriptToEvaluateOnNewDocument` that wraps `fetch` (as `dashboard-answers.test.mjs`'s `initScript`), replaces `/api/data`'s `efficiency` with `fx.efficiency` (or deletes it when null), shallow-merges `fx.metrics` into `metrics` (and `metrics.cost`), appends `fx.threads` to `/api/threads`' list, records every non-GET request in `window.__writes = [{ url, method, body }]`, records every `error` and `unhandledrejection` event's message in `window.__errors = []`, and speeds the 10 s poll to 300 ms.
- Fixture values (the tests assert these; every week is one kit-173 can emit): weeks oldest first; `weeks[3]` has no tickets and no spend (`tickets: 0`, `points: 0`, `score: null`, `parts: null`, `usd_per_point: null`, `hours_per_point: null`, `cache_read_share: null`, `usd_by_phase: {}`, `tokens_by_phase: {}`, `first_pass: 1`); `weeks[10]` score 67; this week `escaped_defects: 1`, parts `{ spend: 0.16, time: 0.15, rework: 0.62 }` and score 31 when `defect`, else `escaped_defects: 0`, parts `{ spend: 0.81, time: 0.74, rework: 0.62 }` and score 72; `efficiency.score` `{ this_week: 31 | 72, last_week: 67 }` and `efficiency.parts` equal to this week's parts; `best: { usd_per_point: 33.2, hours_per_point: 5 }`; `weeks[11].usd_per_point: 41`, `hours_per_point: 6.8`; phase keys `build`, `planning`, `final-review`, `spec`, with `spec` absent from `weeks[0..2]` and `weeks[4..5]`; `observe` with `phase_hours` and `phase_usd` over those keys, `tokens_by_phase` for them, `by_model` `{ 'claude-opus-5-5': { usd: 447 }, 'claude-sonnet-5-5-with-a-very-long-model-name-for-the-390px-check': { usd: 14 } }`, `tokens` `{ input, output, cache_read, cache_write }`; `metrics` values distinct from `observe`'s so the source can be told apart: `metrics.phase_hours` and `metrics.phase_usd` carry an extra key `metrics-only-phase`, `metrics.cost.by_model` carries `metrics-only-model`, `metrics.cost.tokens` differs in `output` (observe 3.1M, metrics 9.9M); `metrics.acknowledged` carries one set-aside finding (`{ kind: 'slow-gate', subject: 'test', ack: { by: 'supervisor', reason: 'known', until: <a week ahead> } }`) and `metrics.findings` one open finding, so Fleet's sections draw; `waste` `[{ id: 'o-20261115-000000001-supervisor', kind: 'costly-ticket', subject: 'kit-87', detail: 'kit-87 cost 3.1× the median merged ticket per point ($254)' }, { id: null, kind: 'low-cache-hit', subject: 'prompt-cache', detail: '58% of input tokens were cache reads, under 60%' }]`; `suggestions` `[{ id: 'eff-costly-ticket-kit-87', kind: 'costly-ticket', … usd: 172, per: 'once' }, { id: 'eff-smaller-model-claude-opus-5-5', kind: 'smaller-model', … }, { id: 'eff-cache-prompt-cache', kind: 'cache', … }, { id: 'eff-mystery-x', kind: 'mystery', … }]`; `metrics.cost.unpriced_models: { 'gpt-x': 3 }`.

- [ ] **Step 1: Re-anchor.** After merging `origin/main` (kit-87 and kit-173 merged), grep index.html for each Anchors row and kit-173's `efficiency` builder in devteam.mjs for the field names in the spec's data section; record the actual names (and any field difference) in `reviews/task-1.md`'s opening paragraph. A field difference is fixed by adjusting the fixture and later tasks here, not kit-173.
- [ ] **Step 2: Write the scaffold test** `the fixture reaches the page`: start a bare-project dashboard (as `dashboard-measure.test.mjs` does, isolated HOME and ports), add `dataRewriteInit(efficiencyFixture())`, open `#overview`, and assert `await p.ev("fetch('/api/data').then(r=>r.json()).then(d=>d.efficiency.weeks.length)") === 12` and `metrics.cost.unpriced_models['gpt-x'] === 3`.
- [ ] **Step 3: Run it** — gate command on `test/dashboard-efficiency.test.mjs`; expected FAIL (no export) then implement the two helpers, then PASS.
- [ ] **Step 4: Commit** `kit-174: efficiency fixture and data rewrite`.

### Task 2: the page, its nav entry, Where it goes, and the Fleet move

**Files:** Modify `docs/devteam/dashboard/index.html`; Test `test/dashboard-efficiency.test.mjs`.

**Interfaces:**
- Consumes: Task 1's helpers; `registerPage`.
- Produces: `renderEfficiency(d)` → card HTML; `effSection(label, bodyHtml)` → one `<section class="sec g12">` with `c3 lbl` and `c9`; `EFF_WASTE_WORDS`, `EFF_SUGG_WORDS` maps (filled in Task 4).

- [ ] **Step 1: Failing tests** in `dashboard-efficiency.test.mjs`:
  - `nav: Efficiency right after Trust, counting the score`: the Autonomy group's links in order have `#efficiency` immediately after `#trust`; its count text is `31%` (defect fixture).
  - `one card, four sections, no OODA, no trials`: `#efficiency .card` count 1 with head text containing `Efficiency Score`; `.sec .lbl` texts deep-equal `['Score', 'Where it goes', 'Waste', 'Suggestions']`; no element text exactly `Observe`, `Orient`, `Decide`, `Act`; no `table` inside the card.
  - `where it goes`: the five headings in order `Tokens by phase`, `Hours by phase`, `USD by phase`, `USD by model`, `Tokens`; bar labels include `build`, `final-review`; `observe` is preferred: no block shows `metrics-only-phase` or `metrics-only-model`, and Tokens' output reads `3.1M`; the source line contains `Measured from the agents' own session logs` and `Unpriced: gpt-x`; with `efficiencyFixture({ source: 'reported' })` it reads `Nothing measured: spend shows only what agents reported`.
  - `fleet keeps its own and loses the four`: at `#sensors?st=fleet`, none of the four headings appear; Findings, `Set aside` (the fixture's `metrics.acknowledged` carries one set-aside finding) and `Checks before merge` do.
  - `efficiency missing`: with `efficiencyFixture({ efficiency: false })`, the card draws; Hours by phase and USD by phase each show `metrics-only-phase`, USD by model shows `metrics-only-model`, Tokens' output reads `9.9M`; Tokens by phase reads `None`; Score and Waste read `None`, Suggestions `None this week`; the nav count is absent; `window.__errors` is empty.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: `registerPage({ id: 'efficiency', title: 'Efficiency', group: 'autonomy', icon: 'zap', count: () => score this week as `${n}%` or null, render })` (the group and null count per shell.md@1's `registerPage`; Task 1's re-anchor confirms what kit-87 landed) placed after Trust's registration; `'efficiency'` after `'trust'` in `SHELL_ROUTES.pages` and `T_SECTIONS`; the card with the four sections (Score, Waste, Suggestions empty "None" for now); Where it goes from `const o = d.efficiency?.observe; const src = o ? { phase_hours: o.phase_hours, phase_usd: o.phase_usd, by_model: o.by_model, tokens: o.tokens, tokens_by_phase: o.tokens_by_phase } : { phase_hours: m.phase_hours, phase_usd: m.phase_usd, by_model: m.cost?.by_model, tokens: m.cost?.tokens, tokens_by_phase: null }` (observe has `by_model`/`tokens` at top level, metrics under `cost`) with the bars helper Fleet uses today, millions formatted as today's `M()`; the source line from `metrics.cost` (today's text, moved). Delete Fleet's four cards' markup and their four render lines.
- [ ] **Step 4: Run** — PASS. Also run `test/dashboard.test.mjs` and any other touched test file that asserted Health's spend cards (grep `phase-time|phase-cost|model-cost|token-note` in `test/`), one at a time; update those asserts to the new place.
- [ ] **Step 5: Commit** `kit-174: the Efficiency page; spend cards move from Fleet`.

### Task 3: the Score section

**Files:** Modify `docs/devteam/dashboard/index.html`; Test `test/dashboard-efficiency.test.mjs`.

**Interfaces:** Consumes Task 2's `effSection`. Produces the ported `scoreLine(values, W, { min, max })`, `spark(values, label)`, `fitCharts()` with `FIT_DRAW[key] = (el, W) => html` (the registry kit-93 reuses); and `effScore(e)` → Score body HTML; `effPhaseBars(weeks, width)` → SVG + legend; `weekName(i, n)` → `'this week' | 'last week' | `${n-1-i} weeks ago``.

- [ ] **Step 1: Failing tests:**
  - `score: this week, last week, parts`: big score `31%`, `last week 67%`; stats spend `16%`, time `15%`, rework `62%`; with `{ defect: false }` the score is `72%` and spend `81%`, time `74%`; with the defect, spend and time lines read `held down: an escaped defect this week`; with `{ defect: false }`, spend reads `best $33 ÷ this week $41 per point` and time `best 5.0 ÷ this week 6.8 hours per point`; rework stat and the mini stat `reviews passed the first time` have a `title` containing `task review`.
  - `the 12-week line`: 11 points drawn (12 slots, slot 3 null), the path has a break at slot 3 (two subpaths, `M` count ≥ 2), this week's point marked (last), last week's marked; the 31 point's `cy` inside the viewBox.
  - `sparklines`: six mini stats named `$ per merged point`, `hours per merged point`, `reviews passed the first time`, `cache reads of input tokens`, `escaped defects`, `merged points`; the `$` one reads `$41 · best $33`; escaped defects reads `1 (target 0)`; the three null-bearing sparks have a gap at slot 3.
  - `phase bars`: 12 slots; slot 3 (no spend) has no segment and no NaN; slots 0–2 and 4–5 have 3 segments; slots 6–11 have 4; a segment `<title>` reads `this week: build $… of $…`; legend has 4 entries.
  - `no NaN, nothing outside the plot`: every `d`, `points`, `x`, `y`, `cx`, `cy`, `width`, `height` attribute in the card's SVGs matches no `NaN`; every circle's centre lies within its SVG's viewBox.
  - `all weeks unscored`: a fixture with every `score`, `usd_per_point`, `hours_per_point`, `cache_read_share` null, `best: null`, `parts: null`: score `–`, ratio lines `–`, no NaN, phase bars `None` when every `usd_by_phase` is `{}`.
  - `charts at the width they get`: at 390 and 1440 wide (`Emulation.setDeviceMetricsOverride`), each `[data-fit] svg`'s `width` attribute equals its container's `clientWidth` (±1), and again after switching widths without reload.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per the spec's Score bullets: numbers from `efficiency.score`, `.parts`, `.best`, `weeks[11]`; phase key order = union of `usd_by_phase` keys sorted by 12-week total desc, ties by key; colours `var(--series-<k % n + 1>)` from the palette Trust uses; port `scoreLine`, `spark` and `fitCharts` from the mock with null gaps, the `{ min, max }` option and the `FIT_DRAW` registry; `fitCharts` runs after each render and on `resize` (one listener).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `kit-174: the Efficiency Score section`.

### Task 4: Waste and Suggestions

**Files:** Modify `docs/devteam/dashboard/index.html`; Modify `test/lib/kit.mjs` only if Task 1's `threads` merge needs a change; Test `test/dashboard-efficiency.test.mjs`.

**Interfaces:** Consumes Task 2's maps, Task 1's `fx.threads`, the kit's `tlStart`, `tlOpen`, `TL.threads`, `tlHome`, `tWhere`. Produces `effWaste(waste)`, the ported `suggestionsList(items, { title })`, `suggestionView(id)` → `` `#efficiency?suggestion=${encodeURIComponent(id)}` ``, `viewPage(view)` → `{ page, tab, query }` (the page id before any `/` or `?`, the tab after `/`, the query as `URLSearchParams`), and `suggestionThread(id)` → the open thread in `TL.threads` whose subject is `{ kind: 'page', view: suggestionView(id) }`, or null.

- [ ] **Step 1: Failing tests:**
  - `waste in plain words`: two lines; texts contain the details; right labels `costly ticket`, `low cache hits`; no line text contains `costly-ticket` or `low-cache-hit`.
  - `waste opens its observation`: click on the first line → the peek opens for `observation/o-20261115-000000001-supervisor` (location hash or the drawer's record id); close; focus it and press Enter → same. The null-id line has no `tabindex`, no `href`; a click leaves no peek open; `__errors` empty.
  - `suggestions numbered, in words, no buttons`: 4 items numbered 1–4; titles `Find where a costly ticket's spend went`, `Use a smaller model where it fits`, `Keep the prompt cache`, `Suggestion`; no item text contains `costly-ticket`, `smaller-model` or `mystery`; each shows its evidence and effect; no `button` inside the Suggestions section.
  - `a suggestion starts a thread on its page subject and writes nothing else`: clear `__writes`; click item 2 → the thread card opens as a draft whose subject (read from `TL.draft.subject`) deep-equals `{ kind: 'page', view: '#efficiency?suggestion=eff-smaller-model-claude-opus-5-5' }`, and `__writes` is empty; type `try it` in the draft and send → exactly one write, a POST to `/api/threads` whose body's subject is that same object. Enter on item 3 opens a draft with view `#efficiency?suggestion=eff-cache-prompt-cache`, and `__writes` gains nothing.
  - `an open thread is opened, not doubled`: with `fx.threads` carrying an open thread `{ id: 't-…', status: 'open', subject: { kind: 'page', view: '#efficiency?suggestion=eff-costly-ticket-kit-87' }, … }`, a click on item 1 opens that thread's card (`tlOpen` of its id; the card shows its turns) and `__writes` stays empty; a resolved thread on the same view does not count (a click opens a draft).
  - `where a suggestion's thread lives`: `tWhere({ kind: 'page', view: '#efficiency?suggestion=eff-x' })` is `Efficiency`; the open thread's pin and card sit on item 1 (`tlHome` of its subject is the `[data-sugg="eff-costly-ticket-kit-87"]` element); and, on its own load with `efficiencyFixture({ suggestions: [<one suggestion, id eff-cache-a.b:c&x=1, kind cache>] })`, a click opens a draft whose view is `#efficiency?suggestion=eff-cache-a.b%3Ac%26x%3D1`, and with an open thread on that view its pin finds the item. A page subject on another page (`#trust`, `#loop/decide`) reads as today (`Trust`, `Loop, Decide`).
  - `redraw keeps the suggestion thread`: with the open thread's card shown, wait three polls; the pin is still on item 1 and `document.activeElement` unchanged.
  - `none this week`: fixture with `suggestions: []` reads `None this week`; `waste: []` reads `None`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: Waste rows as the spec says (`data-open="observation/<id>"`, `tabindex="0"`, `role="link"` and `subj('observation', id, detail)` only when `id`), with Enter through the page's delegated `keydown` handler for rows (kit-87/88's if it covers `[data-open]`, else extended to treat Enter on a focused `[data-open]` as its click); `EFF_WASTE_WORDS` and `EFF_SUGG_WORDS` from the spec, unknown → `words(kind)` / `'Suggestion'`; `suggestionsList` ported from the mock; one delegated click and Enter handler on `[data-sugg]`: `const t = suggestionThread(id); t ? tlOpen(t.id) : tlStart({ subject: { kind: 'page', view: suggestionView(id) }, title, el: item, x, y })` (the `hit` shape `tlStart` takes at the head); `tWhere` and every place that reads a page view's page (`tWhere`, the section lookup ~5492) go through `viewPage`, so a query never becomes part of the page id; `tlHome` gains one case: a page subject whose `viewPage` is `efficiency` with a `suggestion` param returns `main #efficiency [data-sugg="${CSS.escape(param)}"]`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `kit-174: Waste and Suggestions on Efficiency`.

### Task 5: the measure

**Files:** Modify `test/dashboard-measure.test.mjs`; Modify `docs/devteam/dashboard/index.html` (only to fix what the measure reports).

**Interfaces:** Consumes Task 1's `efficiencyFixture`, `dataRewriteInit`.

- [ ] **Step 1: Failing change:** a `PAGES` entry may carry `init` (a script string): before `measureAt`, `Page.addScriptToEvaluateOnNewDocument({ source: init })`, and `Page.removeScriptToEvaluateOnNewDocument` after. So the init runs at every size, an entry with `init` loads a new document each time: for each of the three sizes the test navigates to `about:blank`, then calls `measureAt(p, url('#efficiency'), { sizes: [size], … })`; coming from `about:blank`, the load is always a new document (the dashboard serves only `/` and `/index.html`, so no query is added). Add `{ hash: '#efficiency', init: dataRewriteInit(efficiencyFixture()), ready: "!!document.querySelector('#efficiency [data-fit] svg rect') && /kit-87/.test(document.querySelector('#efficiency').textContent)" }`: the phase bars and the waste line exist only with the fixture.
- [ ] **Step 2: Run** the gate on `test/dashboard-measure.test.mjs`; fix what the checks report (expect long-label overflow at 390 and the prose measure on the score sentence) in index.html, without touching the shared blocks.
- [ ] **Step 3: Run** — PASS at all three sizes.
- [ ] **Step 4: Commit** `kit-174: Efficiency under the measure`.

### Finish

- Verification table (`verification.md`): one row per done-when, the gate commands above and the CI run's conclusion (`gh run view`) at the head; the Nothing-lost table checked against the mock for the final review.
- Merge `origin/main`, re-run the touched test files, push, PR `kit-174-efficiency-page: <title>`, final review by a fresh subagent with the spec and diff (not my conclusions) and the lessons in its brief, `check-ticket`, `merge-request`.

## Rulings

- `m-20261115-203712796-supervisor`: build only after kit-99 and kit-173 merge and approve-plan; reviewer briefs carry k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule; only touched test files, `--test-concurrency=2`.
- `m-20261115-204118085-supervisor`: first-pass counts each task review; the page's tooltip says so (Task 3).
- Owner thread `t-20261115-180708537-owner`: Score, Where it goes, Waste, Suggestions; no OODA headings; no trials.
- `m-20261115-210246084-supervisor`: approve-plan at 9e9b758; reordered after kit-87 and kit-173 (not kit-99), ahead of kit-88; Task 1 re-anchors against kit-87's shell.
- `m-20261115-210456802-supervisor` (re design-change m-20261115-210348878): a suggestion's thread subject is `{kind:'page', view:'#efficiency?suggestion=<id>'}`, which every kit accepts; no devteam.mjs change and no kit-99; the open thread is found client-side by matching that view; port the chart helpers into index.html (kit-93 and kit-99 reuse them later); re-plan T1 and the done_when 3 test, one cold plan review.
- `m-20261115-210500882-supervisor`: done_when 3 now says the page subject.
- `m-20261115-205233392-supervisor`: approve-spec at fe4ddfb; no shell.md bump, the router table is the list (kit-95 names `efficiency` in §5's prose).
