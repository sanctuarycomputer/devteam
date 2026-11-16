# kit-87 verification

At commit 8e2b26a4fb7871ec00cb61b9682dd8cb2c2fa3da (the code and tests as built: tasks T1–T7, the merge of main at 35c864a, and three fixes for CI failures, listed below). Later commits add only ticket records.

**The gate:** CI run 43842117047 (`test.yml`, every job) at 8e2b26a, run through `devteam.mjs gate ci -- gh run watch 43842117047 --exit-status`. Its conclusion was `success`, with 17 of 17 jobs green, confirmed with `gh run view 43842117047`. Its two chrome shards on Node 22 and on Node 24 run `test/dashboard-pages.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-shell.test.mjs` and `test/dashboard.test.mjs`.

**Local runs:** done on this box with `/usr/local/bin/node` (v22), one file at a time at `--test-concurrency=2`, through `devteam.mjs gate test -- …`, with 0 skipped. The `node` on PATH here is v18, which skips every Chrome test (observation o-20261116-044515140).

| Done-when | Command | Result |
|---|---|---|
| 1. Page bar spans the window with the Inbox button at the top right at 1440 and 390, opening `#inbox`; the nav reads Project (Overview, Inbox, Goals, Progress, Board, Library) then Autonomy (Trust, Sensors, Health, Retros, Self Improvement); each link shows only its page; Back works; `#monitoring` → `#sensors` by replaceState; a `th=inbox` head → `#inbox` from the router's redirect table | CI run above; locally `gate test -- node --test --test-concurrency=2 test/dashboard-pages.test.mjs` at 35c864a, and 8e2b26a (debug report) | pass. Test "pages and nav" (nav groups and labels, one page per link, `aria-current`, Back, scroll to top, page bar and Inbox button at 1440×900 and 390×844, a cold unknown head → `#overview`); "history" 1d (`#monitoring` and the `th=inbox` heads read from `SHELL_ROUTES.redirects`). `test/dashboard-shell.test.mjs`: the interim table (16/16) |
| 2. History: a peek opened over Progress closes back to Progress; a cold `#ticket/<id>` opens over Board and closes to `#board`; a reload keeps the page; Back after a Self Improvement tab change restores the tab | same | pass. Test "history" 2a–2e and 2g (a peek inside a peek: Back to the first, × to the page under both), Back/Forward into a peek entry, review and viewer close. `test/dashboard.test.mjs` #43 adds a `talk/` link followed inside `popstate` (fix c4167c3) |
| 3. Settings area: the fleet switch (Park confirms in place, posts fleet), a Settings link, the updated time. Settings page: Maximum parallel workers (− + Save posting owner-setting, "saved; applies once the supervisor lands it" until in force), and Ready to move? when parked or drained. The fleet strip and Check are gone | same | pass. Test "settings area": posts recorded through a `fetch` wrapper; Drain, Run and Park confirm; Escape; a redraw keeps the confirm; busy and refusal; the state words; 390 nav row; no `#fleet-strip` or Check; the switch doesn't move as the lines under it change (fix 8e2b26a). Test "settings page": limits Save `{ key, value }` and No limit `null`; the label equals `/api/data`'s `asked_settings` label; a refusal shows; Ready to move? with blockers, no button, and the `fetch=1` request. `test/fleet-park.test.mjs` 4/4; `test/hub-overview.test.mjs` 19/19, unchanged (outside touches) |
| 4. `test/dashboard-measure.test.mjs` passes with the sidebar, page bar and Settings in its list at 1440×900, 720×800 and 390×844 | CI run above; locally `gate test -- node --test --test-concurrency=2 test/dashboard-measure.test.mjs` at 35c864a | pass, 1/1: 12 pages at 3 sizes, every check. Below 900px `.main` is a subgrid (ruling m-20261116-075055725, recorded in the spec) |
| 5. Every item today's page has stays, checked one by one against the mock's inventory | the final review's inventory walk (`reviews/final-1.md`) | deferred to the final review, as the done-when says |
| 6. Settings lists every `settings_all` entry under its group as the mock shows (name, key in mono, value, "yours to change" on owner-only keys, description); below 700px the value wraps; nothing editable but kit-85's | CI run above; locally `test/dashboard-pages.test.mjs` | pass. Test "settings page": every entry once, under its group, in order; value text worked out independently from kit-84's `shown` kinds; the badge exactly on `owner_only`; no input or button outside the two limits; at 690 the value sits under the name; with `settings_all` missing, a line says so |
| 7. No Fleet section; the switch stays in the sidebar; each worker limit on its own row (No limit or a number, then Save) | same | pass. "settings page": no `.fleet-switch` and no Fleet heading inside `#settings`; `max_active_tickets` and `max_active_per_component` each on their own row; + from No limit gives 1; the value stays within 1–20. "settings area": the switch is in `.settings`, in the nav row at 390 |
| 8. Every Settings row is a thread target: Shift+click starts or opens a thread with subject `{"kind":"page","view":"#settings?key=<key>"}`, titled with its plain name and key; opening it scrolls to and marks the row | CI run above; locally `test/dashboard-pages.test.mjs` and `test/dashboard.test.mjs` | pass. "settings rows as thread targets": the title `Setting · <name> (max_active_tickets)`; the subject sent; the pin on the row; a second Shift+click reuses the thread; the dock's words; a second key's own pin; `#talk/<tid>` from Overview shows the row in view and marked, then unmarked on close. `dashboard.test.mjs` vm: `tWhere` and `parseSettingView` |

## Fixes after the task reviews (all in CI run 43842117047)

The final review is asked to read each one.

- **64557d8:** `test/dashboard-owner-action.test.mjs` failed in CI (run 43829519015).
  - **Cause:** this flake was already there before this ticket; another branch's run 43820501462 fails the same way. The test measures a button, then presses there, and the Inbox can reflow in between (an answered card leaves, or the web fonts load late).
  - **Fix:** two waits, navigation only, with every assertion unchanged (ruling m-20261115-201614084).
  - **Follow-up:** the same reflow can hit a real owner, logged as observation o-20261116-090211229.
- **c4167c3:** `test/dashboard.test.mjs` #43 failed in CI (run 43836179550).
  - **Cause:** the router stamped only on `hashchange`, which fires after `popstate`. A `talk/` link followed in that gap took the stamp of the entry Back had just left, so its × went back too far.
  - **Fix:** `stampEntry()` now also runs on `popstate`. A test step reproduces the race.
- **8e2b26a:** "settings area" failed on Node 22 in CI (run 43839596913).
  - **Cause:** lines under the fleet switch came and went (the fleet's reason line, the error line) and moved its buttons by up to 26px.
  - **Fix:** their space is reserved at 901px and wider, and the test checks that Run stays in place.

## Known, not this ticket's

- **Viewer iframe:** a second artifact opened in one visit adds a history entry inside the frame, so × steps the frame back. This predates the branch; observation o-20261116-053756539.
- **Old fleet strip copy:** `docs/devteam/process/supervisor.md:322` and a comment at `docs/devteam/scripts/devteam.mjs:16014` still describe the strip. Both are outside this ticket's touches (review T5-3).
- **This box only:** `test/pane-question.answer.test.mjs` gets a 403 because the server takes this machine for a box. CI passes it.

Nothing is deferred to beta.
