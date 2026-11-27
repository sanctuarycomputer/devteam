# COMPAT: apps/hub

The compatibility surface of `apps/hub` (`apps-src@1`, `apps/dashboard/APPS.md`): what the kit's tests at kit `8ea96ace0c03ef1cbfe427e6255b9b142968f925` read of `hub.html`, which the app keeps until the cutover. Written once by `node apps/dashboard/scripts/compat-scan.mjs --base 8ea96ace0c03ef1cbfe427e6255b9b142968f925`, which `--check` re-runs; port tickets don't edit it, and an item a later test adds is a carry-over.

A scan, not a parser. It reads each test's string, template and regex literals (code a test runs in the page is a string to it) and keeps only what the page itself has. Its limits: an id or class the page builds from a variable is matched by its fixed prefix only (listed as `prefix*`); a text is a literal of 4 or more characters, with a capital or a space, on a line that reads the page, found in the page's source; a name built at run time is not seen. A view is the port that owns the page lines where the item is written, by the line ranges in `apps/dashboard/scripts/compat-scan.mjs` (lines at kit `3088ac1e`); an item more than one view writes belongs to the page's root view, which holds the shared parts.

## Counts

| page | route | tests that open it | tests that slice it | globals | ids | classes | roles | texts |
|---|---|---|---|---|---|---|---|---|
| `hub.html` | `/` | 20 | 9 | 31 | 34 | 104 | 3 | 110 |

## Globals: `hub.html`

Each is on `window`, registered once by the view named: a function with `expose()` (`src/shared/compat.ts`), a value (a table or a constant the page declares at its top level) by plain assignment. `test/apps-compat.test.mjs` reports each function that is not a function on `window`, and each value that is missing.

| item | kind | view | read by |
|---|---|---|---|
| `box` | value | hub-shell | `test/hub-project-hosts.test.mjs` |
| `closeMenu` | function | hub-overview | `test/hub-project-hosts.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `dbTable` | function | hub-shell | `test/dashboard-shell.test.mjs` |
| `draw` | function | hub-shell | `test/hub-memory-line.test.mjs`, `test/hub-overview.test.mjs`, `test/hub-permalinks.test.mjs` |
| `findBox` | function | hub-shell | `test/hub-overview.test.mjs` |
| `fleetAsk` | function | hub-shell | `test/hub-project-hosts.test.mjs` |
| `fleetSwitch` | function | hub-shell | `test/dashboard-shell.test.mjs` |
| `goalSteps` | function | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs` |
| `heartbeat` | function | hub-shell | `test/dashboard-shell.test.mjs` |
| `keyOf` | function | hub-shell | `test/hub-permalinks.test.mjs` |
| `memoryTick` | function | hub-overview | `test/hub-memory-line.test.mjs` |
| `oaDrawPeople` | function | hub-settings | `test/org-access.people-page.test.mjs` |
| `oaLoad` | function | hub-settings | `test/org-access.people-page.test.mjs` |
| `overviewCard` | function | hub-overview | `test/hub-overview.test.mjs` |
| `paintOverview` | function | hub-overview | `test/hub-memory-line.test.mjs`, `test/hub-overview.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `paintOvTab` | function | hub-shell | `test/hub-overview.test.mjs` |
| `paintSettings` | function | hub-settings | `test/hub-overview.test.mjs`, `test/org-access.people-page.test.mjs` |
| `paintTab` | function | hub-shell | `test/hub-overview.test.mjs` |
| `props` | function | hub-shell | `test/dashboard-shell.test.mjs` |
| `select` | function | hub-shell | `test/hub-permalinks.test.mjs`, `test/hub-project-hosts.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `statusPill` | function | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `tabBar` | function | hub-shell | `test/dashboard-shell.test.mjs` |
| `term` | value | hub-shell | `test/gateway.test.mjs` |
| `tlDraw` | function | hub-threads | `test/operator-threads.hub.test.mjs` |
| `tlOpen` | function | hub-threads | `test/hub-permalinks.test.mjs`, `test/org-access.attribution.test.mjs` |
| `tlRefresh` | function | hub-threads | `test/artifact-close-ask.test.mjs` |
| `tlRelay` | function | hub-threads | `test/operator-threads.hub.test.mjs` |
| `tlStart` | function | hub-threads | `test/org-access.view.test.mjs` |
| `tThread` | function | hub-threads | `test/operator-threads.hub.test.mjs` |
| `viewOnly` | function | hub-shell | `test/artifact-close-ask.test.mjs` |
| `when` | function | hub-threads | `test/dashboard-overview-goals.test.mjs` |

## Ids: `hub.html`

| item | view | read by |
|---|---|---|
| `fff` | hub-shell | `test/pull-refresh.test.mjs` |
| `frames` | hub-shell | `test/hub-overview.test.mjs`, `test/hub-permalinks.test.mjs`, `test/hub-project-hosts.test.mjs`, `test/hub-tab-bar.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `hub-settings` | hub-shell | `test/hub-measure.test.mjs`, `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `mem-holds` | hub-overview | `test/box-memory-e2e.test.mjs`, `test/hub-memory-line.test.mjs` |
| `notify` | hub-shell | `test/hub-overview.test.mjs` |
| `oa-confirm` | hub-settings | `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `oa-fresh` | hub-settings | `test/org-access.people-page.test.mjs` |
| `oa-invite` | hub-settings | `test/hub-overview.test.mjs`, `test/org-access.people-page.test.mjs` |
| `oa-link` | hub-settings | `test/hub-overview.test.mjs`, `test/org-access.people-page.test.mjs` |
| `oa-notice` | hub-settings | `test/org-access.people-page.test.mjs` |
| `oa-people` | hub-settings | `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `oa-rename` | hub-settings | `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `ov-body` | hub-shell | `test/box-memory-e2e.test.mjs`, `test/hub-measure.test.mjs`, `test/hub-memory-line.test.mjs`, `test/hub-overview.test.mjs`, `test/hub-project-hosts.test.mjs`, `test/hub-tab-bar.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `overview` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs`, `test/hub-measure.test.mjs`, `test/hub-memory-line.test.mjs`, `test/hub-overview.test.mjs`, `test/hub-permalinks.test.mjs`, `test/hub-project-hosts.test.mjs`, `test/hub-tab-bar.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `settings-view` | hub-shell | `test/hub-measure.test.mjs`, `test/hub-overview.test.mjs`, `test/hub-permalinks.test.mjs`, `test/hub-tab-bar.test.mjs`, `test/org-access.people-page.test.mjs` |
| `tabs` | hub-shell | `test/hub-overview.test.mjs`, `test/hub-permalinks.test.mjs`, `test/hub-project-hosts.test.mjs`, `test/hub-tab-bar.test.mjs`, `test/project-hosts-e2e.test.mjs`, `test/pull-refresh.test.mjs` |
| `tl` | hub-shell | `test/hub-measure.test.mjs`, `test/hub-overview.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `tl-c-note` | hub-threads | `test/operator-threads.hub.test.mjs` |
| `tl-c-state` | hub-threads | `test/operator-threads.hub.test.mjs` |
| `tl-c-text` | hub-threads | `test/hub-overview.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/org-access.view.test.mjs` |
| `tl-c-title` | hub-threads | `test/hub-permalinks.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `tl-c-turns` | hub-threads | `test/operator-threads.hub.test.mjs` |
| `tl-card` | hub-shell | `test/hub-permalinks.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `tl-chip` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `tl-cursor` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `tl-list` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `tl-op` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `tl-panel` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `tl-pill` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `tl-pinbtn` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `tl-pins` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `view-line` | hub-shell | `test/hub-overview.test.mjs` |
| `view-notify` | hub-settings | `test/hub-overview.test.mjs` |
| `view-only` | hub-shell | `test/hub-overview.test.mjs`, `test/org-access.view.test.mjs` |

## Classes: `hub.html`

| item | view | read by |
|---|---|---|
| `acts` | hub-shell | `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs` |
| `amber` | hub-shell | `test/hub-memory-line.test.mjs`, `test/hub-overview.test.mjs` |
| `badge` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `blocked` | hub-shell | `test/hub-overview.test.mjs` |
| `c2` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `c3` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `c6` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `card` | hub-shell | `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs`, `test/hub-overview.test.mjs` |
| `card-head` | hub-shell | `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs`, `test/hub-overview.test.mjs` |
| `cards` | hub-shell | `test/dashboard-shell.test.mjs` |
| `ceil` | hub-overview | `test/hub-memory-line.test.mjs` |
| `cell` | hub-shell | `test/dashboard-shell.test.mjs` |
| `click` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs`, `test/hub-permalinks.test.mjs`, `test/hub-project-hosts.test.mjs`, `test/hub-tab-bar.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs`, `test/project-hosts-e2e.test.mjs`, `test/pull-refresh.test.mjs` |
| `confirm` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `danger` | hub-shell | `test/org-access.admins.chrome.test.mjs` |
| `done` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `dot` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs`, `test/hub-overview.test.mjs` |
| `end` | hub-shell | `test/dashboard-shell.test.mjs` |
| `err` | hub-shell | `test/dashboard-goals-reorder.test.mjs`, `test/hub-overview.test.mjs`, `test/hub-project-hosts.test.mjs` |
| `fleet-switch` | hub-shell | `test/hub-overview.test.mjs`, `test/hub-project-hosts.test.mjs` |
| `foot` | hub-shell | `test/hub-overview.test.mjs` |
| `full` | hub-overview | `test/hub-memory-line.test.mjs` |
| `g12` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs` |
| `grow` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `heartbeat` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `html` | hub-shell | `test/artifact-close-ask.test.mjs`, `test/validate-parts.test.mjs` |
| `hub-body` | hub-shell | `test/hub-overview.test.mjs` |
| `hub-goal` | hub-shell | `test/dashboard-goals-reorder.test.mjs`, `test/hub-overview.test.mjs` |
| `hub-why` | hub-shell | `test/hub-overview.test.mjs` |
| `k` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs`, `test/hub-project-hosts.test.mjs` |
| `lbl` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `lvl-opt` | hub-shell | `test/hub-overview.test.mjs`, `test/org-access.people-page.test.mjs` |
| `mem` | hub-overview | `test/box-memory-e2e.test.mjs`, `test/hub-memory-line.test.mjs` |
| `mem-bar` | hub-overview | `test/hub-memory-line.test.mjs` |
| `mem-open` | hub-overview | `test/box-memory-e2e.test.mjs`, `test/hub-memory-line.test.mjs` |
| `mem-spark` | hub-overview | `test/hub-memory-line.test.mjs` |
| `mem-words` | hub-overview | `test/box-memory-e2e.test.mjs`, `test/hub-memory-line.test.mjs` |
| `menu-btn` | hub-shell | `test/hub-memory-line.test.mjs`, `test/hub-overview.test.mjs`, `test/hub-project-hosts.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `menu-pop` | hub-shell | `test/hub-memory-line.test.mjs`, `test/hub-overview.test.mjs`, `test/hub-project-hosts.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `meta` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/org-access.attribution.test.mjs` |
| `method` | hub-shell | `test/hub-overview.test.mjs`, `test/org-access.people-page.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `mi` | hub-shell | `test/hub-project-hosts.test.mjs` |
| `msg` | hub-shell | `test/hub-overview.test.mjs` |
| `n` | hub-shell | `test/hub-overview.test.mjs` |
| `nm` | hub-shell | `test/hub-overview.test.mjs`, `test/org-access.people-page.test.mjs` |
| `no-shell` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs` |
| `now` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `oa-err` | hub-shell | `test/org-access.people-page.test.mjs` |
| `oa-intro` | hub-shell | `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `oa-menu` | hub-shell | `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `oa-plist` | hub-shell | `test/org-access.people-page.test.mjs` |
| `oa-toast` | hub-shell | `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `oa-warn` | hub-shell | `test/org-access.people-page.test.mjs` |
| `on` | hub-settings | `test/operator-threads.hub.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `ov-att` | hub-shell | `test/hub-overview.test.mjs` |
| `ov-bar` | hub-shell | `test/hub-overview.test.mjs` |
| `ov-card` | hub-shell | `test/hub-measure.test.mjs`, `test/hub-memory-line.test.mjs`, `test/hub-overview.test.mjs`, `test/hub-project-hosts.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `ov-head` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs`, `test/hub-tab-bar.test.mjs` |
| `ov-mosaic` | hub-shell | `test/hub-overview.test.mjs` |
| `ov-name` | hub-shell | `test/hub-overview.test.mjs`, `test/hub-project-hosts.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `ov-stat` | hub-shell | `test/hub-overview.test.mjs` |
| `ov-stats` | hub-shell | `test/hub-overview.test.mjs` |
| `owner` | hub-shell | `test/operator-threads.hub.test.mjs`, `test/org-access.attribution.test.mjs` |
| `page` | hub-shell | `test/hub-project-hosts.test.mjs` |
| `pagebar` | hub-shell | `test/dashboard-shell.test.mjs`, `test/pull-refresh.test.mjs` |
| `part` | hub-shell | `test/gateway.test.mjs` |
| `person` | hub-shell | `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `pill` | hub-shell | `test/dashboard-shell.test.mjs`, `test/hub-overview.test.mjs` |
| `pmeta` | hub-shell | `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `pulse` | hub-shell | `test/dashboard-shell.test.mjs` |
| `q` | hub-shell | `test/hub-overview.test.mjs` |
| `r` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `red` | hub-shell | `test/dashboard-shell.test.mjs`, `test/org-access.admins.chrome.test.mjs` |
| `rowline` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `rows` | hub-shell | `test/hub-memory-line.test.mjs` |
| `sec` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `seg` | hub-shell | `test/dashboard-shell.test.mjs`, `test/hub-overview.test.mjs` |
| `set` | hub-shell | `test/hub-overview.test.mjs`, `test/hub-tab-bar.test.mjs` |
| `set-desc` | hub-shell | `test/hub-overview.test.mjs` |
| `set-key` | hub-shell | `test/hub-overview.test.mjs` |
| `set-row` | hub-shell | `test/hub-overview.test.mjs`, `test/org-access.people-page.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `sheet` | hub-threads | `test/operator-threads.hub.test.mjs` |
| `shell` | hub-shell | `test/dashboard-shell.test.mjs` |
| `shrink` | hub-shell | `test/hub-overview.test.mjs` |
| `sort` | hub-shell | `test/dashboard-shell.test.mjs` |
| `step-sub` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `steps` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `sub` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs`, `test/hub-memory-line.test.mjs` |
| `sum` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `t` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs`, `test/org-access.people-page.test.mjs` |
| `tab` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-tab-bar.test.mjs` |
| `tab-counts` | hub-shell | `test/hub-overview.test.mjs` |
| `tabbar` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs`, `test/hub-tab-bar.test.mjs` |
| `th` | hub-shell | `test/hub-overview.test.mjs` |
| `tl-closed` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `tl-pin` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `tl-row` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `tl-text` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `tl-turn` | hub-shell | `test/operator-threads.hub.test.mjs`, `test/org-access.attribution.test.mjs` |
| `tl-turns` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `v` | hub-shell | `test/hub-overview.test.mjs` |
| `view-line` | hub-shell | `test/hub-overview.test.mjs` |
| `view-only` | hub-shell | `test/artifact-close-ask.test.mjs`, `test/hub-overview.test.mjs`, `test/org-access.view.test.mjs` |
| `x` | hub-shell | `test/dashboard-shell.test.mjs`, `test/gateway.test.mjs` |

## Roles: `hub.html`

| item | view | read by |
|---|---|---|
| `tab` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs`, `test/hub-overview.test.mjs`, `test/hub-permalinks.test.mjs`, `test/hub-project-hosts.test.mjs`, `test/hub-tab-bar.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/project-hosts-e2e.test.mjs`, `test/pull-refresh.test.mjs` |
| `tablist` | hub-shell | `test/dashboard-shell.test.mjs`, `test/hub-tab-bar.test.mjs` |
| `tabpanel` | hub-shell | `test/dashboard-shell.test.mjs`, `test/hub-project-hosts.test.mjs`, `test/hub-tab-bar.test.mjs` |

## Texts: `hub.html`

| item | view | read by |
|---|---|---|
| `a notification on this device when any project asks you something` | hub-settings | `test/hub-overview.test.mjs` |
| `Add a passkey` | hub-settings | `test/org-access.people-page.test.mjs` |
| `Admin` | hub-settings | `test/org-access.people-page.test.mjs` |
| `all waiting on the supervisor` | hub-overview | `test/hub-overview.test.mjs` |
| `Answer` | hub-threads | `test/dashboard-overview-goals.test.mjs` |
| `Approved` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `ArrowLeft` | hub-shell | `test/dashboard-shell.test.mjs`, `test/gateway.test.mjs` |
| `ArrowRight` | hub-shell | `test/dashboard-shell.test.mjs`, `test/gateway.test.mjs` |
| `Box release` | hub-settings | `test/hub-overview.test.mjs` |
| `Building` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `Built` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `By kind` | hub-overview | `test/box-memory-e2e.test.mjs`, `test/hub-memory-line.test.mjs` |
| `By project` | hub-overview | `test/box-memory-e2e.test.mjs`, `test/hub-memory-line.test.mjs` |
| `Claude Code` | hub-overview | `test/hub-overview.test.mjs` |
| `Copied` | hub-settings | `test/org-access.people-page.test.mjs` |
| `Copy` | hub-settings | `test/org-access.people-page.test.mjs` |
| `Defined` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `Defining` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `DEVTEAM_BOX_TOOLS` | hub-settings | `test/hub-overview.test.mjs` |
| `DEVTEAM_KIT_RELEASE` | hub-settings | `test/hub-overview.test.mjs` |
| `Done` | hub-settings | `test/org-access.people-page.test.mjs` |
| `Drain` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `Drop onto the Terminal tab` | hub-shell | `test/gateway.test.mjs` |
| `Enter` | hub-shell | `test/dashboard-shell.test.mjs` |
| `Every fleet` | hub-shell | `test/hub-overview.test.mjs` |
| `Full` | hub-shell | `test/hub-overview.test.mjs`, `test/org-access.people-page.test.mjs` |
| `Full and View only` | hub-settings | `test/org-access.people-page.test.mjs` |
| `Fully blocked` | hub-shell | `test/hub-overview.test.mjs` |
| `Hide` | hub-overview | `test/hub-memory-line.test.mjs` |
| `Home` | hub-shell | `test/dashboard-shell.test.mjs` |
| `hub not answering` | hub-overview | `test/hub-overview.test.mjs` |
| `Hub served by kit` | hub-settings | `test/hub-overview.test.mjs` |
| `Inbox` | hub-shell | `test/dashboard-shell.test.mjs`, `test/hub-overview.test.mjs` |
| `Invite someone` | hub-settings | `test/org-access.people-page.test.mjs` |
| `Its dashboard stopped answering at` | hub-overview | `test/hub-overview.test.mjs` |
| `Last moved` | hub-shell | `test/hub-overview.test.mjs` |
| `Leave` | hub-settings | `test/org-access.admins.chrome.test.mjs` |
| `Leave this box` | hub-settings | `test/org-access.admins.chrome.test.mjs` |
| `Make admin` | hub-settings | `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `Make full` | hub-settings | `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs` |
| `Make owner` | hub-settings | `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `Make the invite link` | hub-settings | `test/org-access.people-page.test.mjs` |
| `Make the link` | hub-settings | `test/org-access.people-page.test.mjs` |
| `Make view only` | hub-settings | `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `Met?` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `Mixed` | hub-shell | `test/hub-overview.test.mjs` |
| `Moving` | hub-shell | `test/hub-overview.test.mjs` |
| `New Inbox items` | hub-settings | `test/hub-overview.test.mjs` |
| `No goal approved yet` | hub-overview | `test/hub-overview.test.mjs` |
| `None` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `Not answering` | hub-shell | `test/hub-overview.test.mjs` |
| `Not sent from this page: written on the box as yours` | hub-threads | `test/operator-threads.hub.test.mjs` |
| `Notifications` | hub-shell | `test/hub-overview.test.mjs` |
| `Notify me of new Inbox items` | hub-shell | `test/hub-overview.test.mjs` |
| `on this device` | hub-settings | `test/hub-overview.test.mjs` |
| `Open in a new tab` | hub-overview | `test/hub-project-hosts.test.mjs` |
| `Open its dashboard` | hub-overview | `test/hub-project-hosts.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `Other devteam commands` | hub-overview | `test/hub-memory-line.test.mjs` |
| `Overview` | hub-shell | `test/hub-overview.test.mjs`, `test/hub-tab-bar.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `Owner` | hub-settings | `test/org-access.attribution.test.mjs`, `test/org-access.people-page.test.mjs` |
| `Park` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `Parked` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `Partly draining` | hub-overview | `test/hub-overview.test.mjs` |
| `Partly parked` | hub-overview | `test/hub-overview.test.mjs` |
| `Passkeys` | hub-settings | `test/hub-overview.test.mjs` |
| `People` | hub-settings | `test/hub-overview.test.mjs`, `test/org-access.people-page.test.mjs` |
| `Planned` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `POST` | hub-shell | `test/gateway.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/org-access.attribution.test.mjs`, `test/org-access.invites.test.mjs`, `test/org-access.people-page.test.mjs` |
| `Previews` | hub-settings | `test/hub-overview.test.mjs` |
| `Remove` | hub-settings | `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `Rename` | hub-settings | `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `Revoke` | hub-settings | `test/org-access.people-page.test.mjs` |
| `Revoke the link` | hub-settings | `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `Save` | hub-settings | `test/org-access.people-page.test.mjs` |
| `Sees everything here: the hub, dashboards, artifacts, boards, goals and what agents print. Changes nothing and has no terminal. One exception: opening a running preview can set off what that app does when a page opens.` | hub-settings | `test/hub-overview.test.mjs` |
| `Send` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `Send a new link` | hub-settings | `test/hub-overview.test.mjs`, `test/org-access.admins.chrome.test.mjs`, `test/org-access.people-page.test.mjs` |
| `Send it privately, in a message to them, not in a thread on this box: whoever opens it first can use it. It is shown only now.` | hub-settings | `test/org-access.people-page.test.mjs` |
| `send one now, to see that this device gets them` | hub-settings | `test/hub-overview.test.mjs` |
| `Sent` | hub-threads | `test/operator-threads.hub.test.mjs` |
| `Serving` | hub-settings | `test/hub-overview.test.mjs` |
| `Settings` | hub-shell | `test/hub-overview.test.mjs` |
| `signed out` | hub-shell | `test/org-access.invites.test.mjs`, `test/org-access.people-page.test.mjs` |
| `Signing in` | hub-settings | `test/hub-overview.test.mjs` |
| `Start the operator` | hub-threads | `test/operator-threads.hub.test.mjs` |
| `Supervisors waiting` | hub-overview | `test/hub-memory-line.test.mjs` |
| `Take Admin away` | hub-settings | `test/org-access.admins.chrome.test.mjs` |
| `Terminal` | hub-shell | `test/hub-overview.test.mjs`, `test/hub-tab-bar.test.mjs` |
| `Test` | hub-shell | `test/hub-overview.test.mjs` |
| `Test sent` | hub-settings | `test/hub-overview.test.mjs` |
| `the box image this machine runs` | hub-settings | `test/hub-overview.test.mjs` |
| `the version on this box` | hub-settings | `test/hub-overview.test.mjs` |
| `Their name` | hub-settings | `test/org-access.people-page.test.mjs` |
| `Their name, as everyone here sees it:` | hub-settings | `test/org-access.people-page.test.mjs` |
| `They get a link that works once, for 24 hours. You send it to them yourself.` | hub-settings | `test/org-access.people-page.test.mjs` |
| `This machine` | hub-shell | `test/hub-overview.test.mjs` |
| `Threads` | hub-shell | `test/operator-threads.hub.test.mjs` |
| `Update its kit to see what it is doing` | hub-overview | `test/hub-overview.test.mjs` |
| `Upkeep` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `View only` | hub-shell | `test/hub-overview.test.mjs`, `test/org-access.people-page.test.mjs`, `test/org-access.view.test.mjs` |
| `View only: no terminal` | hub-shell | `test/hub-overview.test.mjs` |
| `View only: notifications are for Full people` | hub-settings | `test/hub-overview.test.mjs` |
| `View only: you can look at everything on this box. Buttons that would change something are greyed out.` | hub-shell | `test/hub-overview.test.mjs` |
| `View only: you can look, but not change anything` | hub-shell | `test/artifact-close-ask.test.mjs`, `test/hub-overview.test.mjs` |
| `Waiting on you` | hub-shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `What holds it` | hub-overview | `test/box-memory-e2e.test.mjs`, `test/hub-memory-line.test.mjs` |
| `Workers` | hub-shell | `test/dashboard-overview-goals.test.mjs` |
| `Working` | hub-shell | `test/hub-overview.test.mjs` |
| `Your name, as others here see it:` | hub-settings | `test/org-access.people-page.test.mjs` |
| `Your sign-in` | hub-settings | `test/hub-overview.test.mjs` |

## The poll

The data loop calls `setInterval(…, POLL_MS)` with `POLL_MS` exactly `10000` (`src/shared/poll.ts`): these tests replace `setInterval` for that one value to poll faster.

- `test/dashboard-goals-reorder.test.mjs`
- `test/dashboard-overview-goals.test.mjs`
- `test/fixtures/artifact-viewer/harness.mjs`
- `test/pull-refresh.test.mjs`

These count the page's `/api/data` reads through `window.__polls`, set by the test's own `fetch` wrapper, so each poll must be one `fetch` of `/api/data`:

- `test/dashboard-goals-reorder.test.mjs`
- `test/dashboard-overview-goals.test.mjs`

## Slices (`node:vm`)

Each runs page code under `node:vm`: a marked block it slices, or the declarations of the names it takes; the port moves them to `src/lib/` and the test, ported, imports `lib-dist/`.

| test | page | blocks | names |
|---|---|---|---|
| `test/box-memory-e2e.test.mjs` | `hub.html` | `box-memory` | `memoryView` |
| `test/box-memory-recorder.test.mjs` | `hub.html` | `box-memory` | n/a |
| `test/dashboard-overview-goals.test.mjs` | `index.html`, `hub.html` | `devteam-layout`, `devteam-shell-js`, `goal-block`, `goal-peek`, `hello-pulse`, `score-of` | `NEXT_ID`, `choicesOf`, `closedGoalCardHtml`, `goalBlock`, `goalState`, `goalSteps`, `heartbeat`, `heartbeatDays`, `helloLoad`, `openGoal`, `ovMosaic`, `scoreAt`, `scoreOf`, `spark`, `statusPill`, `thGo`, `when` |
| `test/dashboard-shell.test.mjs` | `index.html`, `hub.html` | `devteam-layout`, `devteam-shell-js`, `shell-routes` | `$`, `bindDbTable`, `bindFleetSwitch`, `bindTabBar`, `closeTarget`, `dbTable`, `escHtml`, `fleetSwitch`, `goalSteps`, `headFor`, `heartbeat`, `hideDrawer`, `list`, `nextSort`, `parseHead`, `peekHead`, `props`, `registerPage`, `rememberedFilters`, `render`, `route`, `saveFilters`, `shellPages`, `sortRows`, `stampFor`, `statusPill`, `tabBar`, `tabPanel`, `tabSelected`, `tabStep`, `withPage` |
| `test/gateway.test.mjs` | `index.html`, `hub.html` | n/a | `box`, `list`, `press`, `term` |
| `test/hub-memory-line.test.mjs` | `hub.html` | `box-memory` | `draw`, `memoryTick`, `paintOverview` |
| `test/hub-overview.test.mjs` | `index.html`, `hub.html` | `box-line`, `hub-overview` | `boxAlertNow`, `draw`, `findBox`, `lessBox`, `list`, `overviewCard`, `ownAlert`, `paintOvTab`, `paintOverview`, `paintSettings`, `paintTab` |
| `test/org-access.invites.test.mjs` | `hub.html` | n/a | `post` |
| `test/validate-parts.test.mjs` | `index.html`, `hub.html` | `devteam-layout` | `draw`, `post` |

## Tests by view

Every test above, with the views it needs (the port plan's view names): its page's root view, and the view of every item it reads. A fixture's views count for each test that uses it.

| test | opens | slices | views |
|---|---|---|---|
| `test/artifact-close-ask.test.mjs` | `hub.html` | n/a | hub-shell, hub-threads |
| `test/box-memory-e2e.test.mjs` | `hub.html` | `hub.html` | hub-shell, hub-overview |
| `test/box-memory-recorder.test.mjs` | n/a | `hub.html` | hub-shell, hub-overview |
| `test/dashboard-goals-reorder.test.mjs` | `hub.html` | n/a | hub-shell |
| `test/dashboard-overview-goals.test.mjs` | `hub.html` | `hub.html` | hub-shell, hub-threads |
| `test/dashboard-shell.test.mjs` | `hub.html` | `hub.html` | hub-shell |
| `test/fixtures/artifact-viewer/harness.mjs` | fixture | fixture |  |
| `test/gateway.test.mjs` | `hub.html` | `hub.html` | hub-shell |
| `test/hub-measure.test.mjs` | `hub.html` | n/a | hub-shell |
| `test/hub-memory-line.test.mjs` | `hub.html` | `hub.html` | hub-shell, hub-overview |
| `test/hub-overview.test.mjs` | `hub.html` | `hub.html` | hub-shell, hub-overview, hub-settings, hub-threads |
| `test/hub-permalinks.test.mjs` | `hub.html` | n/a | hub-shell, hub-threads |
| `test/hub-project-hosts.test.mjs` | `hub.html` | n/a | hub-shell, hub-overview |
| `test/hub-tab-bar.test.mjs` | `hub.html` | n/a | hub-shell |
| `test/lib/pane-question-fixture.mjs` | fixture | fixture |  |
| `test/operator-threads.hub.test.mjs` | `hub.html` | n/a | hub-shell, hub-overview, hub-settings, hub-threads |
| `test/org-access.admins.chrome.test.mjs` | `hub.html` | n/a | hub-shell, hub-settings |
| `test/org-access.attribution.test.mjs` | `hub.html` | n/a | hub-shell, hub-settings, hub-threads |
| `test/org-access.invites.test.mjs` | n/a | `hub.html` | hub-shell, hub-overview |
| `test/org-access.people-page.test.mjs` | `hub.html` | n/a | hub-shell, hub-settings |
| `test/org-access.view.test.mjs` | `hub.html` | n/a | hub-shell, hub-threads |
| `test/project-hosts-e2e.test.mjs` | `hub.html` | n/a | hub-shell, hub-overview |
| `test/pull-refresh.test.mjs` | `hub.html` | n/a | hub-shell |
| `test/split-parity.test.mjs` | `hub.html` | n/a | hub-shell |
| `test/validate-parts.test.mjs` | n/a | `hub.html` | hub-shell, hub-overview |

### Views no item maps a test to

None.
