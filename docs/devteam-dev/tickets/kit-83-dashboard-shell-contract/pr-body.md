The dashboard shell contract, `dashboard-shell@1` (`docs/devteam/dashboard/shell.md`). It is what the dashboard-cleanup page tickets (kit-87 to kit-96) build on, and it changes nothing the owner sees today.

## What lands

- **`shell.md`:**
  - pages and their registration;
  - the URL grammar (page heads `#<page>[?state]` with every state key, today's link heads, each kind's home page, the redirects);
  - `history.state` and closing a peek, and remembered filters;
  - every builder, binder and token;
  - the measure check;
  - a freeze until kit-95.
- **`devteam-layout`**, a CSS marker block, byte-identical in `index.html` and `hub.html`. It holds:
  - the tokens;
  - `.g12` and `.cards`, the page bar and page, cards and card heads, the sectioned status;
  - the tab bar, record table, properties table, segmented control, fleet switch, step bar and heartbeat;
  - the peek and Threads frames, and the reduced-motion rule.

  Every rule is `:where(.shell) …:not(:where(.no-shell, .no-shell *))`. It styles only inside a `.shell` element and outside `.no-shell` regions, and adds no specificity. Today's pages have no `.shell`, so nothing changes until kit-87 adopts the shell region by region.
- **`devteam-shell-js`**, a JS marker block, byte-identical in both pages. It needs no DOM at load and runs in `vm`:
  - builders: `tabBar`, `dbTable`, `props`, `goalSteps`, `heartbeat`, `statusPill`, `fleetSwitch`;
  - binders: `bindTabBar`, `bindDbTable`, `bindFleetSwitch`;
  - registries: `registerPage` and `threadsTabs`;
  - the pure history functions: `parseHead`, `headFor`, `stampFor`, `withPage`, `closeTarget`, `rememberedFilters`, `saveFilters`.
- **`SHELL_ROUTES`** (index's `shell-routes` block), the router's own table, outside the shared block.
- **Two renames, with no visible change:** index's `goalSteps(g, s, R)` is now `goalStepper`, and hub's `STATES` is now the block's `PULSE_STATES`.
- **Tests:**
  - `test/dashboard-shell.test.mjs`: block equality, the scope and fence, and name clashes; the builders, binders and history functions in `vm`; and the measure self-test in Chrome.
  - `test/lib/measure.mjs`, with its eight checks.
  - `test/fixtures/dashboard-shell.html`.
  - `test/dashboard-measure.test.mjs` and `test/hub-measure.test.mjs`: page lists, empty for now, each with a smoke run.

## How to verify

- `node --test --test-concurrency=2 test/dashboard-shell.test.mjs` (Node 20 or later with Chrome for the measure part).
- `docs/devteam-dev/tickets/kit-83-dashboard-shell-contract/compare/compare.mjs` renders today's sections, a peek and the hub from main and from this branch in Chrome, and compares every element's computed style and box. Only the clock line's text width differs.
- Full results in `docs/devteam-dev/tickets/kit-83-dashboard-shell-contract/verification.md`.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
