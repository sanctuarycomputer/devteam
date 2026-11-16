# kit-243 verification

At commit `c84d351617314b5665170464189029cc9bcae762` (origin/main merged in).

| Done-when / check | Command | Result |
|---|---|---|
| Re-plan: validate --strict fails with the first plan's graph and design "does not hold at HEAD" messages when the reviews are stale; passes once reviews at the head approve (done-when 1; spec 1, 2) | `node --test --test-concurrency=2 --test-name-pattern='re-plan branch' test/kit.test.mjs` | ok 12, pass 1, fail 0 |
| First plan behaves as today; a re-plan whose reviews hold at the head passes (done-when 2; spec 3, 4) | same test | ok |
| Red before the fix | same test at T1 (before the T2 code change) | failed at "a re-plan changed after its reviews: … 0 error(s)" |
| Merge gate: check-pr on a detached plan head refuses stale, passes fresh, first plan and re-plan (spec 5; m-20261116-153543205-supervisor) | same test | ok; with `--plan` taken out of check-pr by hand, the re-plan stale check-pr assertion fails ("ok: plan/cards passes the checks") |
| Touched file, whole | `devteam.mjs gate test -- timeout 1500 node --test --test-concurrency=2 test/kit.test.mjs` (before the main merge) | 101/103 pass; the failure is the chain's timing-sensitive monitoring step ("a few slow answers among fast ones are not slow", chain.mjs:868) under load on the shared box, unrelated (observation o-20261116-154758687); CI below runs it green |
| CI (the gate) | `devteam.mjs gate ci -- gh run watch 43900399313 --exit-status`; `gh run view 43900399313 --json conclusion,headSha` | gate passed in 271.8 s; `{"conclusion":"success","headSha":"c84d351617314b5665170464189029cc9bcae762"}` |
