# kit-83 plan: the dashboard shell contract

## TL;DR

- Contract first, alone: `docs/devteam/dashboard/shell.md` at `@1`, plus the two blocks (`devteam-layout`, `devteam-shell-js`) as its fake, committed and sent as a `review-request` for the stage word before any test-driven build task.
- T1 writes `test/dashboard-shell.test.mjs`'s `vm` and text checks red, T2 fills the JS block until they pass, T3 lands the layout block and the fixture and the measure lib, T4 the Chrome self-test and the two list runners.
- Every block selector is `:where(.shell) …` with a `.no-shell` boundary on its subject, so today's pages can't change and later tickets adopt region by region; index's `goalSteps` is renamed `goalStepper`, hub's `STATES` becomes the block's `PULSE_STATES`.
- The router's table (`SHELL_ROUTES`) is a `shell-routes` marker block in `index.html`, outside the shared block.
- Gates: only the touched test files, one at a time, `--test-concurrency=2`, with `/usr/local/bin/node` (22) so Chrome runs; through `devteam.mjs gate test`; CI is the gate (`gate ci -- gh pr checks …`).
- Today's pages unchanged: the scope test, the existing dashboard and hub tests that read these pages, and a scratch computed-style comparison of main against the branch.

## Files (all in `touches`)

- `docs/devteam/dashboard/shell.md` (new)
- `docs/devteam/dashboard/index.html`: the two blocks, the `shell-routes` block, `goalSteps` → `goalStepper` (definition and two callers)
- `docs/devteam/dashboard/hub.html`: the two blocks, `STATES` → `PULSE_STATES`
- `test/dashboard-shell.test.mjs`, `test/lib/measure.mjs`, `test/fixtures/dashboard-shell.html`, `test/dashboard-measure.test.mjs`, `test/hub-measure.test.mjs` (new)
- Touched only if they break on the moved code (each is in `touches` for that reason): `test/dashboard.test.mjs`, `test/gateway.test.mjs`, `test/multirepo-views.test.mjs`, `test/ooda-learning.test.mjs`, `test/ooda-lineage.test.mjs`, `test/plain-questions.test.mjs`, `test/fleet-park.test.mjs`, `test/multirepo-landing.test.mjs`, `test/lib/kit.mjs`, `test/lib/chain.mjs`. T5 runs each of the dashboard- and hub-reading ones once.
- Records under `docs/devteam-dev/tickets/kit-83-dashboard-shell-contract/`.

## C: the contract (alone, before the build)

1. Write `shell.md` (spec §1, every item; names exactly as spec §3).
2. Write both blocks into `index.html` and `hub.html` as the fake (the ticket's notes: its fake is the real components): the layout block in full (ported from the mock's CSS, every selector scoped and fenced as spec §2 says, today's step-bar CSS for `.steps`); the JS block with every builder, binder and history function as spec §3 says. Rename `goalSteps` → `goalStepper` in index; `const STATES = PULSE_STATES;` in hub. The `shell-routes` block in index. (Drafted and run in a scratch copy of the kit during the spec review; the scratch copy is not the record.)
3. Quick checks before committing: both pages parse (`new vm.Script` on each page's main script), the blocks diff equal, and `test/hub-overview.test.mjs` passes (hub pills unchanged).
4. Commit "kit-83: dashboard-shell@1 contract and its blocks", push, `phase contract`, `send supervisor … --kind review-request` naming shell.md, the head, and the `upkeep_days` item shape for `kit-84`. Wait for the word; meanwhile T1 (tests only).

## T1: the shell test, red where the fake is thin

`test/dashboard-shell.test.mjs`, `vm` part: cut each block with a `block(src, name)` helper (index of `/* name start */` to `/* name end */`, exactly one of each), assert equality across the pages and that the layout block follows the tokens block; the scope (parse the block's selectors, splitting on top-level commas only, recursing into `@media`, skipping `@keyframes`: each is `:root` or `:where(.shell) …:not(:where(.no-shell, .no-shell *))[::pseudo]`), the keyframe name used nowhere else, no `shell` class on today's pages, index's `--measure` after the block; no top-level name clash (a regex over `const|let|var|function|class <name>` in each page outside the block) and every inline `<script>` of both pages compiling with `new vm.Script`. Run the JS block in `vm.createContext` and assert the spec's acceptance 2 and 5 cases, with a tiny DOM for the binders (the builders' own HTML parsed into elements with `closest`, `matches` for compound and descendant selectors, `querySelectorAll`, `dataset`, `focus`, `addEventListener`; events fired at a target through the root's listeners). `SHELL_ROUTES` cut from `shell-routes` and run beside it. `statusPill` against a copy of hub's `STATES` pinned in the test from `ad139e1` (review P1), and hub's text reads `const STATES = PULSE_STATES;`. The P2 cases: a peek from a cold peek closes by `replace`; a cold `file?` link's home by path; `withPage`; `saveFilters`' one flat object, shared goal and clearing; a click on a link in a cell and Enter inside a row open nothing. The contract's commit holds the real components, so T1 is red only where the fake falls short; T1 runs it against main first (every block missing: red) and records that.

## T2: the JS block passes

Fill the gaps T1 shows until the `vm` part passes. Each builder escapes text it is given as text and passes HTML where the spec says HTML. Gate: `devteam.mjs gate test -- /usr/local/bin/node --test --test-concurrency=2 test/dashboard-shell.test.mjs`. Task review `reviews/task-2.md`.

## T3: the fixture and the measure lib

- `test/fixtures/dashboard-shell.html`: a template with `<!-- devteam-ui tokens -->`, `<!-- devteam-layout -->` and `<!-- devteam-shell-js -->` slots, a `<body class="shell">`, and a tiny script that draws its content with the block's builders (page bar with title and `.tt` Inbox button, `.page` with a `tabBar`, `.g12` with a `c6` pair of unequal cards, a small card, a card holding `props`, a `dbTable`, a `goalSteps`, a `heartbeat`, and an open `.drawer` peek frame with a `props`). `dashboard-shell.test.mjs` writes the filled page to a temp dir and loads it by `file://`.
- `test/lib/measure.mjs`: `MEASURE_FN` (the in-page function, ported from the mock, eight named checks, options `view`, `bar`, `prose`, `ignore`), `measure(page, opts)`, `measureAt(chrome, url, opts)` over the three sizes (via `Emulation.setDeviceMetricsOverride`, waiting for `document.fonts.ready` and two frames).

## T4: the self-test and the list runners

- In `dashboard-shell.test.mjs` (skip without Chrome): the fixture passes at all three sizes; the `c6` pair's two cards share a top at 720; the `.no-shell` region's computed styles show no block rule (its card's border, its head's height and rule, its pill's display and dot) while the shell's own are styled (review P3); for each of the eight checks, a mutation script run in the loaded fixture after a clean measure makes `measure` report that check by name.
- `test/dashboard-measure.test.mjs`: `const PAGES = []` (each `{ hash, opts }`); a dashboard over a `bareProject` (as `dashboard-answers.test.mjs` does: `dashboardOnFreePort`, `DEVTEAM_HUB_PORT` `PORTS + 2`, `DEVTEAM_PORT_BASE` `PORTS + 3` in the file's own block, `DEVTEAM_*` role variables unset); every listed page must measure clean at each size. With the list empty, a smoke run measures today's `#overview` and asserts only that `measureAt` returned an array for each size (review P5). `test/hub-measure.test.mjs` the same for the hub, served by that dashboard's hub on `DEVTEAM_HUB_PORT` (`/`), with its own list.
- Gate both, and `dashboard-shell.test.mjs`. Task review `reviews/task-4.md`.

## T5: nothing else moved

- Run once each, one at a time: `test/hub-overview.test.mjs`, `test/dashboard-answers.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/next-step.test.mjs`, `test/multirepo-views.test.mjs`, `test/ooda-learning.test.mjs`, `test/fleet-park.test.mjs`, `test/multirepo-landing.test.mjs`, `test/gateway.test.mjs`, then `test/dashboard.test.mjs` (the long one). Fix only what this change broke, inside `touches`. If a test outside `touches` breaks (`hub-overview`, `dashboard-answers`, `dashboard-owner-action`, `next-step`), stop: `phase blocked` and a `design-change` message to the supervisor with the failure and a recommendation; don't edit it (review P6).
- The scratch comparison (a script in this ticket's folder, run with its own `HOME`, a hub port away from 4320, its own dashboard port, `DEVTEAM_*` unset): one `bareProject` with a goal, a ticket and a question, served once with main's `index.html`/`hub.html` and once with the branch's; in Chrome at 1280×900, every element of each of today's sections, with a ticket peek open, and of the hub's Overview: its box and every standard computed property (custom properties, `--*`, left out; review P7), compared. Result and script path in verification.md.

## Verification and finish

`verification.md`: a row per done-when with the exact command and result at a named commit. Merge `origin/main`, re-run the touched files, push, PR (`kit-83-dashboard-shell-contract: <title>`, `## One-way doors` None.), final review from a fresh subagent that hasn't seen the build (`reviews/final-1.md`), `check-ticket`, `merge-request`.

## Review records

`reviews/spec-1.md` and `reviews/plan-1.md` from one combined fresh review (trial a-20261115-074130886), then a cold confirm (`spec-2.md`, `plan-2.md`); `reviews/contract-1.md` is the supervisor's word; `task-2.md`, `task-4.md`; `final-1.md`.

## Review 1 (`reviews/plan-1.md`), how each finding was settled

P1 the pinned copy of hub's `STATES` (T1); P2 the cases (T1); P3 the fence check (T4); P4 `new vm.Script` on every inline script, and `var` in the regex (T1); P5 the smoke runs (T4); P6 stop and ask (T5); P7 the keyframe check (T1) and the comparison's scope (T5); P8 wont-fix: the ticket's notes make the real components the contract's fake, so C commits them; T1 records its run against main as the red.

## Rulings

- m-20261115-092918390-supervisor: approve-spec and approve-plan at 579289c; the .shell scope with a .no-shell boundary is right; send the contract commit alone. upkeep_days' empty day is `{ day, items: [], failed: false }`, never missing: said in shell.md's heartbeat row.

- m-20261115-090246861-supervisor: see spec Rulings.
