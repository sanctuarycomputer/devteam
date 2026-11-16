# kit-94 verification

At commit 542c0af53f4a4cbec1a3bd04fb51b8de5c99037b (origin/main 6a4043c merged in), draft PR #290. On this box: Node 24.14.1 for
the Chrome tests (headless Chromium at /usr/bin/chromium), touched files only, one at a time at --test-concurrency=2 (the box
rule; CI runs the full suite). The local run below is from the T5 run at 27ef42d plus the reruns after each later fix
(357a84a, db4252e, 61a9508; each fix's own tests and the files it touches), and the whole of test/hub-overview.test.mjs again at 542c0af. kit-87 is not merged yet: merged in before ready.

| Done-when | Command | Result |
|---|---|---|
| 1. The Overview: header, machine switch (shared mode, Mixed, "Park N projects?", Run resumes), cards two a row with the standard head, the body, row switch, card click | `node --test --test-name-pattern="^(the Overview: a header\|the machine switch: shared\|a card's switch\|a machine op\|a partly held card)" test/hub-overview.test.mjs` | pass 5/5 |
| 2. The tabs: dot by state (green, blue, amber, red+pulse, grey; building, moving, waiting, blocked, gone, parked), pulse off under reduced motion, title the state word, counts | `--test-name-pattern="^the tabs: a dot"` | pass |
| 3. Blocked border (red, head divider --line) and the Inbox stat (the tab's counts; opens `#overview?th=inbox`) | `--test-name-pattern="^a fully blocked card"` | pass |
| 4. gateway.test.mjs and operator-threads.hub.test.mjs unchanged and green; no Operator button; Terminal tab frames the box terminal | `node --test test/operator-threads.hub.test.mjs`; gateway's four hub tests by name; CI (full gateway) | operator-threads.hub 4/4; gateway hub tests 4/4; CI: green (full gateway in the rest jobs). `git diff origin/main...HEAD -- test/gateway.test.mjs test/operator-threads.hub.test.mjs` is empty |
| 5. The measure: `/#overview` and `/#settings` in PAGES, clean at 1440x900, 720x800, 390x844 | `node --test test/hub-measure.test.mjs` | pass (both pages, three sizes; the measure caught page-top 45px and was fixed in page CSS) |
| 6. Partly held pill: words, hover from `held` and from the counts, click to `#goals` | `--test-name-pattern="^(the partly-held pill: words\|the Overview's rules: the partly-held pill)"` | pass |
| 7. Settings: from the link only, groups and rows (laptop; box: boxLine's parts, Passkeys, Previews), the live Notify control, Test row, focus, keyboard back to the Overview; the Overview has no box line | `--test-name-pattern="^Settings"` | pass 4/4 (the box test ran: hub.localhost loads here) |
| 8. Gap audit rows: top goal +N more and bar, kit behind amber, Not answering (card and tab), old kit line | `--test-name-pattern="^the gap audit rows"` | pass |
| Whole touched files | `test/hub-overview.test.mjs`, `test/hub-measure.test.mjs`, `test/dashboard-shell.test.mjs`, `test/operator-threads.hub.test.mjs` | hub-overview 37/37 at 542c0af; hub-measure 1/1 and operator-threads.hub 4/4 at 27ef42d (hub-measure again after 357a84a); dashboard-shell 16/16 at 542c0af |
| CI (test.yml, every job) | `devteam.mjs gate ci -- gh run watch 43805832024 --exit-status` | run 43805832024 at 542c0af: success, all 17 jobs (kit 18/20/22/24 × chain, rest 1-2/2; chrome 1-2/2 on 22 and 24; tests); gate ci passed in 262 s |

Screenshots (Overview and Settings, light and dark, 1440 and 390): `shots/`.

Not run here: the full suite (shared box; test.yml runs it on every Node major).

## After final review 1 (fixes 14fab7b, head ddd09cc219dd6f50402bce7f3b700687e8173573)

| Check | Command | Result |
|---|---|---|
| F1, F2, F3, F5, F6 fixed, each with a test that failed first | `--test-name-pattern="^(the Overview: a header\|the partly-held pill: words\|the tabs: a dot\|the summary counts\|a fully blocked card)"` | red 4/4 before (each on its new assertion), green 5/5 after |
| Touched files | `test/hub-overview.test.mjs`, `test/hub-measure.test.mjs`, `test/dashboard-shell.test.mjs` | 38/38, 1/1, 16/16 at 14fab7b |
| CI (test.yml, every job) | `devteam.mjs gate ci -- gh run watch 43813798936 --exit-status` | run 43813798936 at ddd09cc: success |

## After final review 2 (fixes 837ab8f2; head b5caa2a5fdd076e5de04c2521a146cef61750a09)

| Check | Command | Result |
|---|---|---|
| F2-1 (a redraw closes the ⋯ menu, focus inside it back to its ⋯; focus elsewhere stays) and F2-2 (another view closes it), with a test that failed first | `--test-name-pattern="^the Overview: a header"` | red before ("closed by the redraw, focus on its ⋯"), green after |
| Touched file | `test/hub-overview.test.mjs` | 38/38 |
| CI (test.yml, every job) | `devteam.mjs gate ci -- gh run watch 43816404589 --exit-status` | attempt 1 failed only on Node 24's Chrome jobs, in `dashboard-owner-action.test.mjs` and `next-step.strategy.test.mjs` (index.html's tests; neither file nor index.html is touched here; Node 22's Chrome jobs passed); observation o-20261116-062914926; attempt 2: success, all 17 jobs |
