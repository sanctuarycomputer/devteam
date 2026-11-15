# kit-174: the Efficiency page — implementation plan

## TL;DR

- One new page in `docs/devteam/dashboard/index.html`, `efficiency`, registered in the Autonomy group right after Trust, drawn as one Efficiency Score card in Trust's ruled sections: Score, Where it goes, Waste, Suggestions. It only formats `/api/data` `efficiency` (kit-173) and `metrics.cost`; it computes nothing.
- Sensors › Fleet loses Hours by phase, USD by phase, USD by model and Tokens; they move to Where it goes, with the source line and unpriced models. Findings, Set aside and the checks stay.
- Suggestions reuse kit-99's list and click-to-thread; a home lookup places `suggestion:eff-…` on Efficiency, other suggestions on Trust.
- Order: test fixture and harness first, then the page shell with Where it goes and the Fleet move, then the Score section's charts, then Waste and Suggestions, then the measure test.
- Tested in headless Chrome by a new `test/dashboard-efficiency.test.mjs` over a real dashboard with `/api/data` rewritten in the page to a known fixture (null weeks, a defect week, a null-id waste item, an unknown suggestion kind), and by `dashboard-measure.test.mjs` with Efficiency added at three sizes.
- Risk: index.html will have been reshaped by kit-87 to kit-99 before this builds, so Task 1 starts by re-anchoring the helper names below to what landed; NaN or out-of-plot SVG from null data, which the tests assert against.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** draw the Efficiency page beside Trust from kit-173's data and move Health's spend cards onto it.

**Architecture:** one `registerPage` call and a render function `renderEfficiency(d)` in index.html, built from Trust's own helpers (the score line, sparklines, `.sec g12` sections, suggestions list, chart fitting) as kit-93/kit-99 landed them. Tests drive real Chrome against a bare-project dashboard and replace `/api/data`'s body in the page.

**Tech Stack:** plain browser JS and CSS in one HTML file; `node:test`, `test/lib/chrome.mjs`, `test/lib/measure.mjs`.

**Spec:** `docs/devteam-dev/tickets/kit-174-efficiency-page/spec.md` (approved text at `5fefef2`).

## Global Constraints

- Every file changed is in the ticket's touches: `docs/devteam/dashboard/index.html`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-measure.test.mjs`, `test/lib/kit.mjs` (others in touches only if a merge from main makes them need a line).
- No change to the `devteam-layout` CSS block or the `devteam-shell-js` block (shell.md@1 frozen until kit-95); no change to `shell.md`.
- No kind id or raw suggestion kind in owner-facing words (strategy R2); phase and model keys are shown as the kit's own labels.
- Running text within `--measure`; nothing sticks out of its parent at 1440x900, 720x800, 390x844.
- Null in any weekly field is a gap in a chart and "–" in a number; the score axis is 0 to 100.
- Tests run on the box one file at a time: `node '/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs' gate test -- node --test --test-concurrency=2 <file>`, never the full suite; judge by the gate's exit code, never a piped excerpt.
- Any probe dashboard outside tests: own HOME (`mktemp -d`), `DEVTEAM_HUB_PORT` away from 4320, own port, `DEVTEAM_*` unset.

## Anchors (re-checked in Task 1, step 1)

The names below are the mock's; kit-93 and kit-99 port Trust's card from it. Task 1 step 1 greps the merged index.html for each and records the kit's actual name beside it in `reviews/task-1.md`'s opening paragraph; later tasks use the recorded names.

| Purpose | Mock name | Used for |
|---|---|---|
| card head | `head(icon, title, right)` / kit `cardHead` | the card head |
| the score's 12-week line | `scoreLine(values)` | Score line (must accept null as a gap and a 0–100 axis; if kit-93's has a fixed 50–100 axis, add an `{ min: 0, max: 100 }` option to it rather than a copy) |
| sparkline | `spark(values, label)` | six mini stats (must skip nulls; same rule) |
| chart refit | `fitCharts()` / `data-fit` | redraw at container width on render and resize |
| suggestions list | `suggestionsList(items)` | Suggestions (with a `title` override per item) |
| click/Enter to thread | kit-99's delegated handler on `[data-subject^="suggestion:"]` | Suggestions |
| page registry | `registerPage` (shell.md@1) | the page |
| item home | `T_HOME` / `T_WHERE` (or kit-99's lookup) | `suggestion:eff-…` placement |

If any helper is missing or its behaviour differs from the spec in a way that needs a change outside touches, stop and send the supervisor a `design-change` message.

## Review Focus

1. A server without `efficiency` (an older kit, a hub showing an older project): the page must draw, Where it goes from `metrics`, no throw — Task 2 test `efficiency missing`.
2. The G1-like empty data (12 weeks, all zeros and nulls, `best: null`): no NaN in SVG, "–" everywhere — Task 3 test `all weeks unscored`.
3. Long phase and model names at 390px: labels truncate, nothing overflows — covered by Task 5's measure at 390 with a fixture model name of 60 characters.
4. The 10-second redraw with a thread open on a suggestion: the pin stays, focus isn't stolen — Task 4 test `redraw keeps the suggestion thread`.
5. A suggestion id with characters a selector would choke on (kit-173 dash-folds, but the page must not rely on it): selected through `CSS.escape` — Task 4 test fixture id `eff-cache-prompt-cache` plus a direct `tHomeOf('suggestion:eff-a.b')` check.

---

### Task 1: the fixture, the in-page data rewrite, and anchors

**Files:**
- Modify: `test/lib/kit.mjs` (append)
- Create: `test/dashboard-efficiency.test.mjs` (scaffold: one test that loads `#efficiency` with the fixture and asserts the rewrite took)

**Interfaces:**
- Produces: `export function efficiencyFixture({ defect = true, efficiency = true } = {})` → `{ efficiency, metrics }` where `metrics` is a partial `{ phase_hours, phase_usd, cost: { source: 'measured', tokens, by_model, unpriced_models } }` to merge into `/api/data`'s `metrics`; and `export function dataRewriteInit(fx)` → a string script for `Page.addScriptToEvaluateOnNewDocument` that wraps `fetch` (as `dashboard-answers.test.mjs`'s `initScript`), replaces `/api/data`'s `efficiency` with `fx.efficiency` (or deletes it when null), shallow-merges `fx.metrics` into `metrics` (and `metrics.cost`), records every non-GET request in `window.__writes = [{ url, method, body }]`, and speeds the 10 s poll to 300 ms.
- Fixture values (the tests assert these): weeks oldest first; `weeks[3]` unscored (`tickets: 2`, `score: null`, `parts: null`, `usd_per_point: null`, `hours_per_point: null`, `cache_read_share: null`); `weeks[10]` score 67; `weeks[11]` score 31 with `escaped_defects: 1` when `defect`, else 72 with 0; `best: { usd_per_point: 33.2, hours_per_point: 5 }`; `weeks[11].usd_per_point: 41`, `hours_per_point: 6.8`; `parts` this week `{ spend: 0.81, time: 0.74, rework: 0.62 }`; phase keys `build`, `planning`, `final-review`, `spec`, with `spec` absent from `weeks[0..5]`; `observe` with `tokens_by_phase` for those four keys, `by_model` `{ 'claude-opus-5-5': { usd: 447 }, 'claude-sonnet-5-5-with-a-very-long-model-name-for-the-390px-check': { usd: 14 } }`; `waste` `[{ id: 'o-20261115-000000001-supervisor', kind: 'costly-ticket', subject: 'kit-87', detail: 'kit-87 cost 3.1× the median merged ticket per point ($254)' }, { id: null, kind: 'low-cache-hit', subject: 'prompt-cache', detail: '58% of input tokens were cache reads, under 60%' }]`; `suggestions` `[{ id: 'eff-costly-ticket-kit-87', kind: 'costly-ticket', … usd: 172, per: 'once' }, { id: 'eff-smaller-model-claude-opus-5-5', kind: 'smaller-model', … }, { id: 'eff-cache-prompt-cache', kind: 'cache', … }, { id: 'eff-mystery-x', kind: 'mystery', … }]`; `metrics.cost.unpriced_models: { 'gpt-x': 3 }`.

- [ ] **Step 1: Re-anchor.** After merging `origin/main` (kit-99 and kit-173 merged), grep index.html for each Anchors row and kit-173's `efficiency` builder in devteam.mjs for the field names in the spec's data section; record the actual names (and any field difference) in `reviews/task-1.md`'s opening paragraph. A field difference is fixed by adjusting the fixture and later tasks here, not kit-173.
- [ ] **Step 2: Write the scaffold test** `the fixture reaches the page`: start a bare-project dashboard (as `dashboard-measure.test.mjs` does, isolated HOME and ports), add `dataRewriteInit(efficiencyFixture())`, open `#overview`, and assert `await p.ev("fetch('/api/data').then(r=>r.json()).then(d=>d.efficiency.weeks.length)") === 12` and `metrics.cost.unpriced_models['gpt-x'] === 3`.
- [ ] **Step 3: Run it** — gate command on `test/dashboard-efficiency.test.mjs`; expected FAIL (no export) then implement the two helpers, then PASS.
- [ ] **Step 4: Commit** `kit-174: efficiency fixture and data rewrite`.

### Task 2: the page, its nav entry, Where it goes, and the Fleet move

**Files:** Modify `docs/devteam/dashboard/index.html`; Test `test/dashboard-efficiency.test.mjs`.

**Interfaces:**
- Consumes: Task 1's helpers; `registerPage`.
- Produces: `renderEfficiency(d)` → card HTML; `effSection(label, bodyHtml)` → one `<section class="sec g12">` with `c3 lbl` and `c9`; `EFF_WASTE_WORDS`, `EFF_SUGG_WORDS` maps (filled in Task 4); `tHomeOf(ref)` → page id and `tWhereOf(ref)` → words (or kit-99's if it added them), used at every read of `T_HOME`/`T_WHERE` for an item ref.

- [ ] **Step 1: Failing tests** in `dashboard-efficiency.test.mjs`:
  - `nav: Efficiency right after Trust, counting the score`: the Autonomy group's links in order have `#efficiency` immediately after `#trust`; its count text is `31%` (defect fixture).
  - `one card, four sections, no OODA, no trials`: `#efficiency .card` count 1 with head text containing `Efficiency Score`; `.sec .lbl` texts deep-equal `['Score', 'Where it goes', 'Waste', 'Suggestions']`; no element text exactly `Observe`, `Orient`, `Decide`, `Act`; no `table` inside the card.
  - `where it goes`: the five headings in order `Tokens by phase`, `Hours by phase`, `USD by phase`, `USD by model`, `Tokens`; bar labels include `build`, `final-review`; the source line contains `Measured from the agents' own session logs` and `Unpriced: gpt-x`.
  - `fleet keeps its own and loses the four`: at `#sensors?st=fleet`, none of the four headings appear; Findings and `Checks before merge` do.
  - `efficiency missing`: with `efficiencyFixture({ efficiency: false })`, the card draws, Hours/USD/model/Tokens draw from `metrics` (bar label `build` present), Tokens by phase reads `None`, the nav count is empty, and `window.__errors` (collected by the init script from `error` events) is empty.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: `registerPage({ id: 'efficiency', title: 'Efficiency', group: 'Autonomy', icon: 'zap', count: () => score this week as `${n}%` or '', render })` placed after Trust's registration; `'efficiency'` after `'trust'` in `SHELL_ROUTES.pages` and `T_SECTIONS`; the card with the four sections (Score, Waste, Suggestions empty "None" for now); Where it goes from `d.efficiency?.observe ?? metrics` with the bars helper Fleet uses today, millions formatted as today's `M()`; the source line from `metrics.cost` (today's text, moved). Delete Fleet's four cards' markup and their four render lines.
- [ ] **Step 4: Run** — PASS. Also run `test/dashboard.test.mjs` and any other touched test file that asserted Health's spend cards (grep `phase-time|phase-cost|model-cost|token-note` in `test/`), one at a time; update those asserts to the new place.
- [ ] **Step 5: Commit** `kit-174: the Efficiency page; spend cards move from Fleet`.

### Task 3: the Score section

**Files:** Modify `docs/devteam/dashboard/index.html`; Test `test/dashboard-efficiency.test.mjs`.

**Interfaces:** Consumes Task 2's `effSection`, the anchored `scoreLine`, `spark`, chart refit. Produces `effScore(e)` → Score body HTML; `effPhaseBars(weeks, width)` → SVG + legend; `weekName(i, n)` → `'this week' | 'last week' | `${n-1-i} weeks ago``.

- [ ] **Step 1: Failing tests:**
  - `score: this week, last week, parts`: big score `31%`, `last week 67%`; stats spend `81%`, time `74%`, rework `62%`; with the defect, spend and time lines read `held down: an escaped defect this week`; with `{ defect: false }`, spend reads `best $33 ÷ this week $41 per point` and time `best 5.0 ÷ this week 6.8 hours per point`; rework stat and the mini stat `reviews passed the first time` have a `title` containing `task review`.
  - `the 12-week line`: 11 points drawn (12 slots, one null), the path has a break at slot 3 (two subpaths, `M` count ≥ 2), this week's point marked (last), last week's marked; the 31 point's `cy` inside the viewBox.
  - `sparklines`: six mini stats named `$ per merged point`, `hours per merged point`, `reviews passed the first time`, `cache reads of input tokens`, `escaped defects`, `merged points`; the `$` one reads `$41 · best $33`; escaped defects reads `1 (target 0)`; the three null-bearing sparks have a gap at slot 3.
  - `phase bars`: 12 bar groups; week 0 has 3 segments and week 11 has 4; a segment `<title>` reads `this week: build $… of $…`; legend has 4 entries.
  - `no NaN, nothing outside the plot`: every `d`, `points`, `x`, `y`, `cx`, `cy`, `width`, `height` attribute in the card's SVGs matches no `NaN`; every circle's centre lies within its SVG's viewBox.
  - `all weeks unscored`: a fixture with every `score`, `usd_per_point`, `hours_per_point`, `cache_read_share` null, `best: null`, `parts: null`: score `–`, ratio lines `–`, no NaN, phase bars `None` when every `usd_by_phase` is `{}`.
  - `charts at the width they get`: at 390 and 1440 wide (`Emulation.setDeviceMetricsOverride`), each `[data-fit] svg`'s `width` attribute equals its container's `clientWidth` (±1), and again after switching widths without reload.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per the spec's Score bullets: numbers from `efficiency.score`, `.parts`, `.best`, `weeks[11]`; phase key order = union of `usd_by_phase` keys sorted by 12-week total desc, ties by key; colours `var(--series-<k % n + 1>)` from the palette Trust uses; extend the anchored line/spark helpers with null gaps and a `{ min, max }` option where they lack them (no copies).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `kit-174: the Efficiency Score section`.

### Task 4: Waste and Suggestions

**Files:** Modify `docs/devteam/dashboard/index.html`; Test `test/dashboard-efficiency.test.mjs`.

**Interfaces:** Consumes Task 2's maps and `tHomeOf`/`tWhereOf`; kit-99's suggestion list and its click/Enter → thread handler. Produces `effWaste(waste)`, `effSuggestions(list)`.

- [ ] **Step 1: Failing tests:**
  - `waste in plain words`: two lines; texts contain the details; right labels `costly ticket`, `low cache hits`; no line text contains `costly-ticket` or `low-cache-hit`.
  - `waste opens its observation`: click on the first line → the peek opens for `observation/o-20261115-000000001-supervisor` (location hash or the drawer's record id); close; focus it and press Enter → same. The null-id line has no `tabindex`, no `href`; a click leaves no peek open; `__errors` empty.
  - `suggestions numbered, in words, no buttons`: 4 items numbered 1–4; titles `Find where a costly ticket's spend went`, `Use a smaller model where it fits`, `Keep the prompt cache`, `Suggestion`; no item text contains `costly-ticket`, `smaller-model` or `mystery`; each shows its evidence and effect; `#efficiency .card button` count inside Suggestions is 0.
  - `a suggestion starts a thread and writes nothing else`: clear `__writes`; click item 2 → exactly one write, a POST whose body's subject is `{"kind":"item","ref":"suggestion:eff-smaller-model-claude-opus-5-5"}`; Enter on item 3 → one more, ref `suggestion:eff-cache-prompt-cache`.
  - `an open thread is opened, not doubled`: with the fixture's `/api/threads` answer carrying an open thread on `suggestion:eff-costly-ticket-kit-87` (the rewrite also patches `/api/threads`' body, as kit-97's test does; add that to `dataRewriteInit` with `fx.threads`), a click opens that thread's card and `__writes` stays empty.
  - `where an eff- suggestion lives`: `tHomeOf('suggestion:eff-x') === 'efficiency'`, `tWhereOf(...) === 'Efficiency'`, `tHomeOf('suggestion:raise-trust-x') === 'trust'`, `tHomeOf('suggestion:eff-a.b') === 'efficiency'`; the opened thread's card shows "Efficiency" as its place.
  - `redraw keeps the suggestion thread`: with a thread open from item 2, wait three polls; the pin is still on item 2 and `document.activeElement` unchanged.
  - `none this week`: fixture with `suggestions: []` reads `None this week`; `waste: []` reads `None`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: Waste rows as the spec says (`data-open="observation/<id>"` and `subj('observation', id, detail)` only when `id`); `EFF_WASTE_WORDS` and `EFF_SUGG_WORDS` from the spec, unknown → `words(kind)` / `'Suggestion'`; Suggestions through kit-99's list with each item's `data-subject="suggestion:<id>"`; `tHomeOf`/`tWhereOf` return Efficiency for refs starting `suggestion:eff-`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `kit-174: Waste and Suggestions on Efficiency`.

### Task 5: the measure

**Files:** Modify `test/dashboard-measure.test.mjs`.

**Interfaces:** Consumes Task 1's `efficiencyFixture`, `dataRewriteInit`.

- [ ] **Step 1: Failing change:** a `PAGES` entry may carry `init` (a script string): before `measureAt`, `Page.addScriptToEvaluateOnNewDocument({ source: init })`, and `Page.removeScriptToEvaluateOnNewDocument` after. Add `{ hash: '#efficiency', init: dataRewriteInit(efficiencyFixture()), ready: "document.querySelectorAll('#efficiency .sec').length === 4" }`.
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
- `m-20261115-205233392-supervisor`: approve-spec at fe4ddfb; no shell.md bump, the router table is the list (kit-95 names `efficiency` in §5's prose).
