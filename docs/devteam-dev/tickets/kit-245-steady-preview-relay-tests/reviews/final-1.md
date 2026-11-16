# Final review, pass 1

- Reviewer: final-reviewer (fresh subagent, claude-opus)
- Reviewed: 4f05d4f386af1b7ce399398030083fbb6f7ff68b (the whole branch)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | done-when 1 (the PR names why Node 18 got 503s, honestly) | pr-body.md Summary; spec.md "What the PR will say" | The cause is hedged ("likely, not proven"), but "most likely" claims more than the evidence supports. One leg, "the port is anyone's", doesn't fit the ws failure. If another socket held the freed port on 127.0.0.1, the old `dev.listen(devPort, '127.0.0.1')` would have failed with EADDRINUSE as an unhandled 'error', not produced a 503. The leg that does fit, a dev port equal to the never-bound `ttydPort`, is the one the spec measured at 0 in 2000 tries, and two hits six minutes apart are improbable. Suggest calling the cause "unexplained", naming the candidates (ttydPort collision; a squatter on 127.0.0.1 for the ::1 case), and pointing to the new diagnostics for the next occurrence. | fixed: pr-body.md and spec.md now call the cause unexplained, name the candidates and what each would show, and point to the probe's diagnostics |
| F2 | Minor | done-when 2 ("linked in the PR") | pr-body.md "How to verify" | The PR body says the stress links are in verification.md and doesn't link the four runs itself. Copy the four run links into the PR body. | fixed: the four stress-run links are in the PR body |
| F3 | Minor | quality (a broken relay should fail, not hang) | test/gateway.test.mjs ws test, teardown | Reviewer mutation M5 removes only the client-to-dev-server direction (`pipeline(socket, up)` in previewUpgrade). The ws test then never reports: the file ran until `timeout 150` killed it. It doesn't go green, so nothing is masked, but this direction of breakage hangs the file rather than reporting red. The same mechanism the plan amendment describes for removing both pipelines. Not in the done-whens; worth a follow-up. | wont-fix here: outside the done-whens, and it never goes green; a follow-up is logged as an observation (upgraded sockets left half-open hold the gateway's close in tests) |

Checked, no issue found:
- Diff scope: `git diff origin/main...HEAD --stat`: test/gateway.test.mjs, .github/workflows/test-stress.yml, and ticket records only. cloud/gateway.mjs is unchanged. 4f05d4f adds only verification.md.
- test-stress.yml: the only substantive change is `'18'` in `inputs.node.options`, plus the header comment's Node line. Repeat cap and everything else unchanged.
- (A) `previewReady` can't mask a gateway defect. It is one GET, never retried, and fails unless it gets status 200, the app's exact body and no extra hub read. So a map that lacks the name (refresh-on-miss) or any relay error fails right there, and the probe can only add a failure point. The gateway caches no host per port (previewHost and proxyPreview try 127.0.0.1 then ::1 on every call; read at cloud/gateway.mjs:1179-1218). So the GET probe on cool-owl doesn't pre-warm the POST's ::1 retry: the POST with a body still exercises "the body survives the retry". The probe's extra request lands before the `seen.at(-1)` assertions and each of those follows its own request, so no index shifted. The ws dev server's HTTP handler records nothing, so the probe doesn't touch `seen` or `upstreamClosed`. The `/dev/` page is fetched only in failure messages (`previewState`), never before an assertion, so it refreshes nothing on the passing path.
- (A) Nothing asserted before is weaker, with one move noted. Test 57's first session request used to go through servePreview's refresh-on-miss; now `pollPush()` runs first, so test 57 no longer covers that path. Reviewer mutation M3 (refresh-on-miss deleted) leaves test 57 green, but test 58 fails (its first request at test/gateway.test.mjs:2243 relies on the refresh), so the file still catches it. The anonymous "no hub poll" assertion is unchanged and comes before the new pollPush.
- `devServer`: listens on port 0 and rejects `ttydPort` (itself a never-bound freePort), HUB and P..P+24, the same refusals previewLinks applies (cloud/gateway.mjs:310). The gateway's own port can't be returned while the gateway is listening. Bounded at 5 tries with a named failure.
- `wsClient`'s `next()` now rejects after 5 s, and `c` is closed in finally. Every waiter clears its timer.
- (B) `timeout 400 sh docs/devteam-dev/tickets/kit-245-steady-preview-relay-tests/evidence/mutate.sh` on Node v18.20.4. Mutation (a), ::1 only: tests 57 and 59 are `not ok` at previewReady with ports and `/dev/ … not answering` (pass 0, fail 2). Mutation (b), up-to-socket pipeline removed: test 59 is `not ok`, "no frame came back within 5 s" (pass 1, fail 1). Output: "restored cloud/gateway.mjs". Matches evidence/mutate.out.
- Reviewer's own mutations, from a script under /data/home/tmp/claude-1000/kit245-review.sIWZKy/, each restored by `git checkout -- cloud/gateway.mjs`:
  - M1, previewHost tries ::1 only (upgrade path only): 59 `not ok`, "the first socket: 503; dev port …". So the upgrade path is still tested on its own, past the HTTP probe.
  - M2, proxyPreview tries ::1 only: 57, 58 and 59 all `not ok`.
  - M3, no refresh on a miss: 58 `not ok`; 57 and 59 ok (see above).
  - M4, no ::1 retry in proxyPreview: 57 `not ok` at `cool-owl: 503`.
  - M5: hangs (F3).
- `git status --short` after all mutations: empty, cloud/gateway.mjs restored.
- Unmutated, at 4f05d4f: `timeout 300 node --test --test-concurrency=2 test/gateway.test.mjs` gave tests 73, pass 73, fail 0. The two tests alone (`--test-name-pattern="^a preview(:|'s WebSocket)"`) passed 3 of 3 (pass 2, fail 0 each).
- verification.md matches the runs it links (`gh run view`):
  - 43914660700 and 43914676121 (at 7cd017c8) and 43915098070 and 43915346068 (at c4e04fbb): test-stress, workflow_dispatch, success. Logs show node-version 18 (v18.20.8), FILES test/gateway.test.mjs, `--repeat 5`.
  - 43914666378 and 43914671087: cancelled, as stated.
  - CI 43914791057: test, pull_request, success, at c4e04fbb. The 4f05d4f commit adds a doc only.
- PR body and spec say the cause is likely, not proven, and list what was ruled out (timers, store, local repro). Hedged as asked; see F1 on its strength.

Verdict: APPROVE 4f05d4f386af1b7ce399398030083fbb6f7ff68b
