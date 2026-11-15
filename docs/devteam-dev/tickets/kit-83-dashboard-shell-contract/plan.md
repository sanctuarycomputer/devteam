# kit-83 plan: the dashboard shell contract

## TL;DR

- Contract first, alone: `docs/devteam/dashboard/shell.md` at `@1`, plus the two blocks (`devteam-layout`, `devteam-shell-js`) as its fake, committed and sent as a `review-request` for the stage word before any test-driven build task.
- T1 writes `test/dashboard-shell.test.mjs`'s `vm` and text checks red, T2 fills the JS block until they pass, T3 lands the layout block and the fixture and the measure lib, T4 the Chrome self-test and the two list runners.
- Every block selector sits under `:where(.shell)`, so today's pages can't change; index's `goalSteps` is renamed `goalStepper`, hub's `STATES` becomes the block's `PULSE_STATES`.
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
2. Write both blocks into `index.html` and `hub.html` as the fake: the layout block in full (ported from the mock's CSS, every selector put under `:where(.shell)`, today's step-bar CSS copied for `.steps`); the JS block with every builder, binder and history function as the spec says. Rename `goalSteps` → `goalStepper` in index; `const STATES = PULSE_STATES;` in hub. The `shell-routes` block in index.
3. Quick checks before committing: both pages parse (`new vm.Script` on each page's main script), the blocks diff equal, and `test/hub-overview.test.mjs` passes (hub pills unchanged).
4. Commit "kit-83: dashboard-shell@1 contract and its blocks", push, `phase contract`, `send supervisor … --kind review-request` naming shell.md, the head, and the `upkeep_days` item shape for `kit-84`. Wait for the word; meanwhile T1 (tests only).

## T1: the shell test, red where the fake is thin

`test/dashboard-shell.test.mjs`, `vm` part: cut each block with a `block(src, name)` helper (index of `/* name start */` to `/* name end */`), assert equality across the pages, the `:where(.shell)` scope (parse selectors from the CSS block text, skipping `@media` wrappers and `:root`), no `shell` class on today's pages, and no top-level name clash (a regex over `function|const|let|class <name>` at line start in each page outside the blocks, against the block's own top-level names). Run the JS block in `vm.createContext({})` and assert the spec's acceptance 2 and 5 cases, with a fake root for the binders (`addEventListener` recording handlers; events with `target.closest(sel)` over a tiny element tree built from attributes; `focus` recorded). `SHELL_ROUTES` cut from `shell-routes` and run beside it. `statusPill` compared with hub's overview card: `PULSE_STATES` keys against the label and tone `overviewCard` would draw (`pill ${tone}`), and hub's `STATES` text is `PULSE_STATES`. Commit red, with any failures listed in the review record.

## T2: the JS block passes

Fill the gaps T1 shows until the `vm` part passes. Each builder escapes text it is given as text and passes HTML where the spec says HTML. Gate: `devteam.mjs gate test -- /usr/local/bin/node --test --test-concurrency=2 test/dashboard-shell.test.mjs`. Task review `reviews/task-2.md`.

## T3: the fixture and the measure lib

- `test/fixtures/dashboard-shell.html`: a template with `<!-- devteam-ui tokens -->`, `<!-- devteam-layout -->` and `<!-- devteam-shell-js -->` slots, a `<body class="shell">`, and a tiny script that draws its content with the block's builders (page bar with title and `.tt` Inbox button, `.page` with a `tabBar`, `.g12` with a `c6` pair of unequal cards, a small card, a card holding `props`, a `dbTable`, a `goalSteps`, a `heartbeat`, and an open `.drawer` peek frame with a `props`). `dashboard-shell.test.mjs` writes the filled page to a temp dir and loads it by `file://`.
- `test/lib/measure.mjs`: `MEASURE_FN` (the in-page function, ported from the mock, eight named checks, options `view`, `bar`, `prose`, `ignore`), `measure(page, opts)`, `measureAt(chrome, url, opts)` over the three sizes (via `Emulation.setDeviceMetricsOverride`, waiting for `document.fonts.ready` and two frames).

## T4: the self-test and the list runners

- In `dashboard-shell.test.mjs` (skip without Chrome): the fixture passes at all three sizes; the `c6` pair's two cards share a top at 720; for each of the eight checks, a mutation script run in the loaded fixture makes `measure` report that check by name (and the clean fixture didn't).
- `test/dashboard-measure.test.mjs`: `const PAGES = []` (each `{ hash, opts }`), a dashboard over a `bareProject` (as `dashboard-answers.test.mjs` does, own ports from `test/lib/kit.mjs`'s `PORTS` range, checked free) started only when the list is non-empty; asserts no failures per page and width. `test/hub-measure.test.mjs` the same for the hub. With empty lists each file runs one test that says so and passes.
- Gate both, and `dashboard-shell.test.mjs`. Task review `reviews/task-4.md`.

## T5: nothing else moved

- Run once each, one at a time: `test/hub-overview.test.mjs`, `test/dashboard-answers.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/next-step.test.mjs`, `test/multirepo-views.test.mjs`, `test/ooda-learning.test.mjs`, `test/fleet-park.test.mjs`, `test/multirepo-landing.test.mjs`, `test/gateway.test.mjs`, then `test/dashboard.test.mjs` (the long one). Fix only what this change broke, inside `touches`.
- The scratch comparison (scratchpad script, own `HOME`, ports away from 4320, `DEVTEAM_*` unset): a `bareProject` dashboard from main's `index.html` and from the branch's, each page section's every element's computed style and box dumped in Chrome at 1280 and compared; the hub likewise with one fixture instance. Result and script path in verification.md.

## Verification and finish

`verification.md`: a row per done-when with the exact command and result at a named commit. Merge `origin/main`, re-run the touched files, push, PR (`kit-83-dashboard-shell-contract: <title>`, `## One-way doors` None.), final review from a fresh subagent that hasn't seen the build (`reviews/final-1.md`), `check-ticket`, `merge-request`.

## Review records

`reviews/spec-1.md` and `reviews/plan-1.md` from one combined fresh review (trial a-20261115-074130886), then a cold confirm; `reviews/contract-1.md` is the supervisor's word; `task-2.md`, `task-4.md`; `final-1.md`.

## Rulings

- m-20261115-090246861-supervisor: see spec Rulings.
