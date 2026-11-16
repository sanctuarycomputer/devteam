# kit-174 verification

Code head verified: `4915dc16f3810ee23ddb8c868a31d656ba12eed7` (PR #301), which is `26cd4b68` with origin/main merged in (kit-244 and release-prep v0.60.0; they add records and a Dockerfile stamp and touch none of this ticket's files). Commits after it add only this ticket's records.

Local runs: each touched test file on its own, through `devteam.mjs gate test -- node --test --test-concurrency=2 <file>` on Node 22 (the box's default Node 18 skips the Chrome tests), with every `DEVTEAM_*` variable unset for the test process. Every run below ended with exit 0, `# fail 0`, `# skipped 0`, except the dashboard.test.mjs runs at 4915dc16 (below the table).

| File | At 4915dc16 (merged) | At 7c8c336a (before the merge) |
|---|---|---|
| test/dashboard-efficiency.test.mjs | pass 28 | pass 28 |
| test/dashboard-measure.test.mjs | pass 1 | pass 1 |
| test/dashboard-shell.test.mjs | pass 16 | pass 16 |
| test/dashboard-pages.test.mjs | pass 6 | pass 6 |
| test/dashboard.test.mjs | pass 156, fail 1; then pass 155, fail 2 (see below) | pass 157 |

At 4915dc16, dashboard.test.mjs failed only the laptop-relay tests: `the laptop's relay: the lens on GET alone…` both times, and `the laptop's relay never serves a dashboard…` the second time. Each failure is one `HEAD /` with Host `devteam-aph9.onrender.com` reaching the test's fake app. This box is a Render service (`RENDER_SERVICE_NAME=devteam-aph9`), and Render's port scan probes newly opened ports, while those tests assert that nothing but `/api/hello` reaches the app. This ticket changes neither those tests nor the relay. They passed at 7c8c336a, and CI runs them green at 4915dc16 (below). Logged as o-20261116-113442707.

The other files in touches (gateway, multirepo-views, ooda-learning, ooda-lineage, plain-questions, fleet-park, multirepo-landing, test/lib/chain.mjs) were not changed. CI runs them.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | dashboard-efficiency in CI: Efficiency right after Trust with this week's score as its count; one Efficiency Score card drawn like the Trust Score card, with Score (this and last week, spend/time/rework with ratios, the 12-week line with its gap and marks, six sparklines, phase bars) | the gate run above; CI below | Subtests `nav: Efficiency right after Trust, counting the score`, `one card, four sections, no OODA, no trials`, `score: this week, last week, parts`, `the 12-week line`, `sparklines`, `phase bars`, `no NaN, nothing outside the plot`, `all weeks unscored`, `charts at the width they get`, `charts draw when their page comes into view`, `charts follow new data` all pass. The card's text never contains `Autonomy Score`. |
| 2 | Where it goes in order with the kit's phase keys; Fleet no longer holds the four cards (Findings, Set aside, Checks before merge stay); Waste in plain words, opening its observation on a click or Enter | same | `where it goes: from observe, with the source line` (order; rows largest first in `$`, `h`, `M`; `$128`, `21.4h`, `$447`), `fleet keeps its own and loses the four`, `efficiency missing: Where it goes from metrics, the rest None`, `waste in plain words`, `waste opens its observation` (click and Enter on the line with an id; the null-id line not focusable, no peek, no error) pass. |
| 3 | Suggestions numbered, with evidence and effect and no buttons; a click or Enter starts a thread on `{"kind":"page","view":"#efficiency?suggestion=<id>"}`, opens the open one, writes nothing else; placed on Efficiency; "None this week" | same | `suggestions numbered, in words, no buttons`, `a suggestion starts a thread on its page subject and writes nothing else` (POST /api/thread-new with the page subject, the only write), `an open thread is opened, not doubled`, `a Shift+click on a suggestion is its page subject too`, `where a suggestion's thread lives`, `the dock brings a suggestion thread home`, `no false "changed since"`, `Enter places the draft by the item`, `redraw keeps the suggestion thread`, `none this week` pass. Subject shape per rulings m-20261115-210456802 and m-20261115-210500882 (the plan's Spec line). |
| 4 | dashboard-measure in CI with Efficiency at 1440x900, 720x800, 390x844 on every check | the gate run above; CI below | Passes: Efficiency is measured with the fixture at all three sizes, and every check in test/lib/measure.mjs reports nothing. One limit, recorded in notes/anchors.md (task-5 review T5-1): at 720 and 390 measure.mjs skips page-top (it runs only at `scrollY === 0`, and the narrow sizes are reached scrolled down), for Efficiency as for Settings. A fresh load fails page-top at 720 on every shell page (kit-87's nav row). Observations o-20261116-110914358 and o-20261116-111831635. The supervisor is taking it to a follow-up ticket (m-20261116-111852695). |
| 5 | Every Fleet item stays, on Fleet or on Efficiency, checked one by one against the mock | final review (final-1.md) | Deferred to the final review, which checks the spec's Nothing lost table item by item. |
| 6 | Sections Score, Where it goes, Waste, Suggestions, laid out as Trust; no OODA headings, no trials table; the mock at main is the reference | check 1's test; final review | `one card, four sections, no OODA, no trials` passes. The final review compares the page with the mock. |
| CI | test.yml green on every job at the code head | `devteam.mjs gate ci -- gh run watch 43856679142 --exit-status --interval 60`; `gh run view 43856679142 --json conclusion,headSha,jobs` | Gate ci passed in 67.9s (exit 0). Run 43856679142 at headSha 4915dc16, attempt 1: `success` on all 17 jobs. The earlier run 43855620100 at 7c8c336a was `success` too. |

## Rulings not in the approved spec and plan

All are in notes/anchors.md with their reasons; in brief:
- Node 22 for local test runs.
- A suggestion's thread uses kit-87's Settings-row mechanism (`T_SUGG_VIEW`, `tlRowOf`) rather than a new view helper. New threads POST to `/api/thread-new`.
- The fit charts use a ResizeObserver and a `data-v` attribute, so they draw when their page comes into view and follow new data.
- The phase colours are the page's own tokens, without the error red.
- dashboard-measure measures Efficiency in one document across the three sizes (T5-1 above).
- T1-3: the plan's defect-week values can't come out of kit-173's scoring. The fixture's numbers are chosen for the page's checks, and its comment says so.
- m-20261116-104109047 / m-20261116-104144265: test/dashboard-shell.test.mjs and test/dashboard-pages.test.mjs were added to touches.
