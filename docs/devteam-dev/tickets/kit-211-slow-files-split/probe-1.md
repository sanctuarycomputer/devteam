# kit-211 done-when 6: the hook probe

`node probe-run.mjs e8022ac <out>` on Node 22.23.4, this box, at 2f1b48f (test files as at 2f1b48f; base = e8022ac). Exit 0. Each test run alone with `fs.rmSync` made to throw for its fixture folders; "left" = processes it started still alive after its hooks, before any exit listener (lib/cli.mjs's warm pool counted apart). Everything left was then killed by the runner and a second look found nothing.

| test | left at the base expected | base | head |
|---|---|---|---|
| a message for a pane that is asking is held | no | children 15 (pool 3) left 0 | children 15 (pool 3) left 0 |
| held lines are typed once each | no | children 19 (pool 3) left 0 | children 19 (pool 3) left 0 |
| a claim nobody is working goes back as it was | yes | children 24 (pool 3) left 1 (sleep 600) | children 24 (pool 3) left 0 |
| held lines wait for the input box | no | children 16 (pool 3) left 0 | children 16 (pool 3) left 0 |
| the dashboard: an answer only from its own page | yes | children 7 (pool 3) left 2 (node devteam.mjs; node -e) | children 7 (pool 3) left 0 |
| a menu whose digit only moves the cursor | yes | children 7 (pool 3) left 2 (node devteam.mjs; node -e) | children 7 (pool 3) left 0 |
| one click is one answer | yes | children 7 (pool 3) left 2 (node devteam.mjs; node -e) | children 7 (pool 3) left 0 |
| a question that goes as the key is sent | yes | children 8 (pool 3) left 2 (node devteam.mjs; node -e) | children 8 (pool 3) left 0 |
| on a box an answer needs the gateway | yes | children 7 (pool 3) left 2 (node devteam.mjs; node -e) | children 7 (pool 3) left 0 |
| the dashboard page: | yes | children 8 (pool 3) left 3 (node devteam.mjs; node -e; chromium --show-component-extension-options) | children 8 (pool 3) left 0 |
| the hub takes the owner's turns | no | children 2 (pool 0) left 0 | children 2 (pool 0) left 0 |
| on a box the hub takes a press only | no | children 2 (pool 0) left 0 | children 2 (pool 0) left 0 |
| the Overview in Chrome | no | children 3 (pool 0) left 0 | children 3 (pool 0) left 0 |
| on a box the standalone hub | yes | children 1 (pool 0) left 2 (node devteam.mjs; node devteam.mjs) | children 1 (pool 0) left 0 |
