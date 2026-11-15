# Task 3 review, pass 1

- Reviewer: task-reviewer-3 (fresh subagent, claude-opus)
- Reviewed: f57715b8e1ad49be80bc2464e7ba0276ccec91db (Task 3, diff since 0d9fb7cf1df7e12dd9f655aa6e7bc0c7aafda3dc)

Ran in the worktree (kt.sh, "standalone hub takes a press"): every 403 part passes. The 200 fails with "its signature is not the gateway's", because this box's /opt/devteam/gateway.mjs makes the kit read /etc/devteam/thread-key.pub. That matches the known baseline and the Task 3 ruling.

To check CI, I made a scratch copy (git archive of f57715b). In its devteam.mjs I pointed `BOX_GATEWAY_FILE` and `BOX_THREAD_KEY` at /nonexistent-ci/..., so the copy sees no box files, as on a CI runner. I ran it with the session's devteam env and the box's DEVTEAM_PUBLIC_URL/DEVTEAM_PREVIEWS unset. The test passes there (1.6 s): the signed press gets 200, its proof is in the store, it is typed into the pane, and the replay is refused. The ledger also records CI run 43647835355 green on this test.

Mutations, each in a fresh copy of that CI-like scratch tree, running this test alone. Every one was killed, and each failure came from the check that was mutated:
- the hub's nonce check removed (plan Step 2): the replay got 400 "that press was taken already" (the owner's command's own check), not 403;
- the Origin test dropped from ownerPost: the foreign Origin got 200;
- the content-type test dropped: text/plain got 200;
- the Sec-Fetch-Site test dropped: the press with no Sec-Fetch-Site got 200;
- `same-site` accepted: same-site got 200;
- `boxed = false` (no signature needed): the unsigned press got 400 from the command, not 403;
- ownHost check removed: the foreign Host got 302;
- the cross-site check on /instances.json removed: 200;
- the cross-site check on /operator/threads removed: 200;
- proof not handed to the owner's command: the signed press got 400.

Wrong-reason analysis: every signed refusal carries the same valid signature as the final 200, and ownerPost checks the headers before it reads the signature. So in CI each of those 403s can only come from the header check it names. The final 200 also proves that none of them consumed the nonce. On this box the header refusals land at the same checks (they come before the key read). The unsigned 403 can only be boxOnly. The weak spots are the refusals that assert no reason (below).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | plan T3 Step 1 ("re-sent → 403 `/used already/`"); done-when 4 ("one reusing a nonce") | test/operator-threads.test.mjs, last `refused(...)` ('the same signature again') | The replay asserts only status 403, not the reason the plan names. gatewayProofProblem also returns 403 for "its signature is too old" (OPERATOR_PROOF_MS 120 s). The test's timeout is 240 s and the pane wait comes before the resend, so a slow run could pass this line on staleness and not on nonce reuse. Assert `r.json.error` matches `/used already/`. | noted (Minor: the replay is also asserted by the store staying at 2 lines) |
| F2 | Suggestion | quality.md §3 (a refusal must fail for the named reason) | same test, the header refusals | No refusal checks its error text. The final 200 and the check order make this sound today. Matching `owner actions only from the hub's own page` (and `the hub answers only on its own address` for Host) would keep it sound if the checks were reordered or merged. | noted (Suggestion) |

Verdict: APPROVE f57715b8e1ad49be80bc2464e7ba0276ccec91db
