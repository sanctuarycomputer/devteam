# kit-245 verification

At commit `c4e04fbbf45c28d9915a0ae9d5c23a62e85089d1` (test code as at `7cd017c8`; c4e04fb adds only pr-body.md). Local runs on Node v18.20.4.

| Done-when / check | Command | Result |
|---|---|---|
| 1: both tests' dev servers listen on port 0 and take the port from their own `listening` address (`devServer`); one unretried probe through the relay (`previewReady`) before anything is asserted | `timeout 120 node --test --test-concurrency=2 --test-name-pattern="^a preview(:\|'s WebSocket)" test/gateway.test.mjs`, 5 times | 5 of 5: pass 2, fail 0 |
| 1: the PR names why Node 18 got 503s | pr-body.md, Summary | Names the likely cause (freePort's unbound window on a busy runner), says it is not proven, and lists what was ruled out (spec.md) |
| Touched file, whole | `timeout 200 node --test --test-concurrency=2 test/gateway.test.mjs` | tests 73, pass 73, fail 0 |
| 2: test-stress.yml takes node 18; 4 × repeat 5 on Node 18 | `gh workflow run test-stress.yml --ref ticket/kit-245-steady-preview-relay-tests -f files=test/gateway.test.mjs -f repeat=5 -f node=18` | All four: "test/gateway.test.mjs, repeat 5, load 0, concurrency 4, node 18. All 1 file passed on every repeat." [43914660700](https://github.com/sanctuarycomputer/devteam/actions/runs/43914660700) and [43914676121](https://github.com/sanctuarycomputer/devteam/actions/runs/43914676121) at 7cd017c8; [43915098070](https://github.com/sanctuarycomputer/devteam/actions/runs/43915098070) and [43915346068](https://github.com/sanctuarycomputer/devteam/actions/runs/43915346068) at c4e04fb. Two more dispatches (43914666378, 43914671087) were cancelled by the workflow's concurrency group (it keeps one pending run), so the rest were dispatched one at a time |
| 3: mutation (a): the relay tries `::1` only | `sh docs/devteam-dev/tickets/kit-245-steady-preview-relay-tests/evidence/mutate.sh` (output in `evidence/mutate.out`) | Both tests fail at `previewReady`: `cool-tiger: 503 … dev port …, terminal …; /dev/ … not answering`. gateway.mjs restored |
| 3: mutation (b): the dev server's frames are not relayed back | same | ws test fails: `no frame came back within 5 s`. gateway.mjs restored |
| CI (the gate) | `devteam.mjs gate ci -- timeout 1800 gh run watch 43914791057 --repo sanctuarycomputer/devteam --exit-status`; `gh run view 43914791057 --json conclusion,headSha` | gate ci passed; `{"conclusion":"success","headSha":"c4e04fbbf45c28d9915a0ae9d5c23a62e85089d1"}` |

Not merged with main yet: the supervisor merges after kit-88 (which shares gateway.test.mjs in touches but doesn't change it). Once kit-88 lands, origin/main gets merged in and the gates are re-run.
