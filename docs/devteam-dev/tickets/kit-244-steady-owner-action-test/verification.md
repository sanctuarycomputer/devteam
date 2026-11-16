# kit-244 verification

## At the merged head 4e6c815 (main with kit-87, 90abe27, merged in)

kit-87 (a1cb222) added `redrawnWithout(q)` to this test, in the same two places as this branch's `settled(q, n)`: after Q's answer and after Q2's. It waits for `!DATA.questions.some((x) => x.id === q) && !card(q)`. `DATA` is the raw server data that `render()` stores (dashboard l.4977). So it waits for the same render that draws `#answered-sum` from the server's answered list. The merge keeps main's version and drops `settled`, since both waits are for one event. `git diff origin/main 4e6c815 -- test/` is empty. kit-87 also waits for the web fonts before subtest 3.

| Done-when | Command | Result |
|---|---|---|
| 1. The subtest waits for the page state it needs through the page's own signals, not a fixed timeout, and the cause is named in the PR | `sed -n 85,95p;175,190p test/dashboard-owner-action.test.mjs`. `sh evidence/repro.sh race`. `sh evidence/repro.sh fixed`. | Before Q2's and Q3's clicks the subtest waits for a render of server data without the answered question and for its card to be gone. That is a `soon` on page state; no sleep, retry or longer timeout. The cause is in pr-body.md § The cause. The race and fixed-order repros are below; the fixed order is the same render the merged wait waits for. |
| 2. test-stress.yml on that file, 20 repeats on Node 22, passes every run | `gh workflow run test-stress.yml --ref ticket/kit-244-steady-owner-action-test -f files=test/dashboard-owner-action.test.mjs -f repeat=5 -f node=22`, four times, each after the last finished | 43849681951, 43849902735, 43850053023, 43853298644: all success at 4e6c815. In each run: node v22.23.4, 5× `# pass 6 / # fail 0 / # skipped 0`. That is 20 of 20. |
| 3. The test still fails when Done is let through while a record is unchanged | `sh evidence/mutate.sh` at 4e6c815 | Subtests 1–4 ok. `not ok 5 - Done goes through once every record is done; never while one is unchanged`, `timed out: not done yet` (now l.188). `evidence/mutation.txt` is byte-identical to the run before the merge. |
| Gate (local) | `devteam.mjs gate test -- timeout 300 /usr/local/bin/node --test --test-concurrency=2 test/dashboard-owner-action.test.mjs` at 4e6c815 | passed in 25.0 s: pass 6, fail 0, skipped 0 |
| CI (test.yml) | the PR's checks at 4e6c815 | 43849681986: success |

## Before the merge (this branch's `settled` version, 01fd1ef)

| Done-when | Result |
|---|---|
| 1 | Race repro at main e2e19105: `timed out: the note focused`; the measured point lands on "DETAILS Answered (1)" (`evidence/repro-race.txt`). Settle first, then measure: the point lands on the TEXTAREA, pass 6 (`evidence/repro-fixed.txt`). |
| 2 | 43826419937 and 43826595672 (8636a1f), 43826814063 and 43826989988 (01fd1ef): all success, 20 of 20 on node v22.23.4. |
| 3 | `not ok 5`, `timed out: not done yet` (then l.190). |
| CI | 43828059894 at ce28522: success. |
