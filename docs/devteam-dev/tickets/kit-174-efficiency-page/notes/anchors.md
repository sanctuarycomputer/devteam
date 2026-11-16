# kit-174: anchors at build (after kit-87, a1cb222; kit-173, 6fffb5c) and the build's rulings

Task 1 step 1 checked each Anchors row of the plan against the merged index.html and devteam.mjs.

## What kit-87 and kit-173 landed

| Plan's name | At the head | Effect on the plan |
|---|---|---|
| `registerPage({ id, title, group, icon, count, render })` | as planned (shell block). But the pages are registered by one loop over `[id, title, group, icon]` with `count: () => null, render: () => {}`; each page is a `<section data-page>` in `main.page`, drawn by the one `render()`, and a nav count is an element id in `PAGE_COUNT_ID` that `render()` fills | Efficiency joins that list after `trust` (group `autonomy`, icon `zap`), gets `<section id="efficiency" data-page="efficiency">` after Trust's, and `PAGE_COUNT_ID.efficiency = 'n-efficiency'`, filled by `render()` |
| `SHELL_ROUTES.pages` | `SHELL_ROUTES_PAGES` in the `shell-routes` block (outside the frozen blocks) | `'efficiency'` after `'trust'` there |
| `T_SECTIONS` | as planned; Trust reads `Trust Ladder` there | `efficiency: 'Efficiency'` |
| `cardHead(icon, label, { extra, id, rows })` | as planned | the card head |
| `.sec g12`, `.c3 lbl`, `.c9` | the layout block's `.sec` is itself a two-column grid (140px label, then the body), not a 12-column row; `.g12` on the same element would be overridden | each section is `<section class="sec">` with `<div class="lbl">` and a body `<div>`: the same ruled look, without `c3`/`c9` |
| Sensors › Fleet | Health is still its own page (`#health`, `<section id="health">`) until kit-93 folds it into Sensors | the four spend cards leave `#health`; the test checks `#health` |
| `bars(el, obj, fmt, none)` | as planned (fills an element) | used through a string twin for the blocks |
| `tlStart`, `tlOpen`, `TL.threads`, `tlHome`, `tWhere`, `tKey`, `tlTargetRect`, `tlGoTo` | as planned, plus kit-87's Settings rows: a page subject on `#settings?key=<key>` (`T_SETTING_VIEW`, `parseSettingView`, `tlSettingOf`, `settingRow`), which `tSubjectAt`, `tlStart` (opens the open thread), `tlTargetRect`, `tlReveal`, `tlRoute` and `subjectHead` already handle | a suggestion's page subject follows that pattern (below) instead of the plan's `viewPage` |
| Trust's Trust Score card, ruled sections, chart helpers | not landed (kit-93, kit-99 come after) | ported from the mock as the plan says |

kit-173's `efficiency` (devteam.mjs `efficiencyData`): fields as the spec says. `first_pass`, `parts.*` and `cache_read_share` are fractions (0..1), drawn as percentages. `suggestions[]` are `{ id, kind, what, evidence, effect, usd, per }`. No difference to fix.

## Rulings made in the build

- The tests run on Node 22 (`/data/home/.local/share/mise/installs/node/22.23.4/bin/node`): the box's default Node 18 has no `WebSocket`, so every Chrome test skips and reads as passing (kit-87's o-20261116-044515140). Each gate run is checked for `# skipped 0`.
- The suggestion's page subject follows kit-87's Settings rows rather than a new `viewPage`: `T_SUGG_VIEW` / `parseSuggView(view)` for `#efficiency?suggestion=<encoded id>`, and one `tlRowOf(s)` (a Settings row or a suggestion item, with its element) used where `tlSettingOf` is today (`tlTargetRect`, `tlReveal`, `tlRoute`). `tlStart` opens the open thread for either. `tWhere` reads `Efficiency` for it. `subjectHead` already gives `#efficiency` for the view, since the router drops a state key the page doesn't take. Cost if wrong: none to the data (same subject, same server); only the code's shape differs from the plan.
- `efficiencyFixture` also takes `threads` (the plan's test passes open threads through it), and `effThread()` builds one as `/api/threads` gives it.
