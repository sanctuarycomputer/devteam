# Task 1 review, pass 1

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus)
- Reviewed: 55b51e700a0fb08e0a25efe88466fce6b95e9977 (Task 1, diff since e4c60cc)

Read the whole diff against spec.md (What changes 1-2, Security, Edge cases) and plan Task 1 Steps 1-3. The press checks are unchanged. Nothing in the request handler, `ownerPost` (Origin / Sec-Fetch-Site / JSON content type, `threadsNeedGateway`, gateway proof, `seenNonces`), `ownHost` or the `/instances.json` and `/operator/threads` Sec-Fetch-Site refusals was edited. The only request-path change is the list body (`...listHead`). `threadsNeedGateway()` depends on `onBox()` and the gateway file, not on the project, so a standalone hub run from a folder that is no repo is still boxed on a box. The dashboard's hub is the same as before: its non-standalone `error` branch is byte-identical (gives up on a non-hub holder, retry unref'd), `processLog(log, 'dashboard')` keeps the dashboard's wording exactly, its owner actions keep `cwd: mainRoot`, and the only addition is `kit: kitVersion()` (spec ruling F2-1). The operator guard in the dispatch does not list `hub`, so `DEVTEAM_ROLE=operator` still can't run it (spec 1, last bullet).

Ran (wrapper `kt.sh`) `test/hub-overview.test.mjs` in the worktree: T1's 5 new tests pass. Test 9 (T2's, at the later commit 0d9fb7c) failed there; that is outside this review. At 55b51e7 itself (`git archive` into a temp dir, devteam env stripped), the 5 T1 tests passed (base: pass 5 fail 0). Mutations, each run on that copy with `--test-name-pattern` for the T1 tests:

- M1 the non-hub line logged at every retry (`now !== held` dropped): test 7 fails. Killed.
- M2 standalone retry timer `.unref()`'d: test 7 fails. Killed.
- M3 no rotation (threshold raised to 1 GiB): test 8 fails. Killed.
- M4 SIGTERM left out of `processLog`: test 8 fails. Killed.
- M5 standalone `kit` = `kitVersion()` unguarded, not `ownKitVersion()`: test 5 fails. Killed.
- M6 `actionCwd = mainRoot` always: all pass. Survives (F1).
- M7 `'hub'` removed from `machineWide`: all pass. Survives (F2).
- M8 the dashboard's hub claims `image: true`: test 6 fails. Killed.
- M9 the bad `--release` log line removed: all pass. Survives (F3).
- M10 the standalone `error` branch disabled (falls through to the dashboard's): test 7 fails. Killed.

The press checks against a standalone hub on a box are T3's to prove (plan T3 Step 2 mutates the nonce check). This task's diff doesn't touch them, as checked above.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec What changes 1 bullet 4 ("cwd: process.cwd() … from a git checkout it is that checkout's root, which a standalone hub must not use"); quality §3 mutate-to-prove | `startHub` `actionCwd` | M6 survives: no test can tell `process.cwd()` from `mainRoot`. They are also nearly equivalent in fact. A standalone hub's `mainRoot` is derived from the cwd's git common dir (the image's kit has no `scriptCommon`), and the child `operator-thread` resolves its home from that same common dir whichever folder of the repo it starts in. So the spec's stated reason (not using a checkout's root) isn't really achieved by this line. It is harmless and does what the spec literally says. Worth one sentence in the comment, or a T3 assertion run from inside a git repo, if the property matters. | noted (Minor: kept explicit, so the standalone hub never depends on how the child resolves its home) |
| F2 | Minor | spec What changes 1 ("added to the machineWide list … so it runs from a folder that is no repo and no project"); quality §3 | `homeAt` `machineWide` | M7 survives. The die path only fires when the cwd or the script's checkout is a git repo with no `project/settings.md`. Every test runs the image kit from a non-repo cwd, where `proj` is null. A run of `hub` from a cwd that is an unadopted git repo would prove it. | noted (Minor: the image kit is no repo, where machineWide is not reached; the box test of kit-51 runs it end to end) |
| F3 | Minor | spec Edge cases ("`--release` given empty or not vX.Y.Z … the hub logs the problem once") | `cmdHub`; test 'hub without --release …' | M9 survives: the test checks `kit: null` and that the hub is alive, but never checks the `is not vX.Y.Z` log line (once) in `hub-<port>.log`. | noted (Minor) |
| F4 | Minor | plan T1 Step 3 ("log the non-hub line only when the last state logged wasn't `other`"); spec 1 bullet 3 ("never at every retry") | `startHub` standalone `error` branch, `held` | `held` records the last state seen, including unlogged ones (`unsure`, `hub`), not the last one logged. A non-hub holder that sometimes takes over 2 s to answer gives other → unsure → other, and the line is logged again each time. The spec's own edge case only excuses a flip through a real hub. Fix: update `held` only when a line is logged or the state is `hub`, or ignore `unsure`. | fixed (`unsure` no longer resets the state logged; test "a non-hub that answers slowly now and then is still logged once", RED 3 lines → GREEN 1) |
| F5 | Suggestion | spec Contracts ("Documented in the comment above startHub") | comment above `startHub` | At this sha the comment already describes `DEVTEAM_IMAGE_HUB` in cmdDashboard, which only T2 (0d9fb7c) adds. It is accurate once T2 lands, so this is only noted. | noted (the comment is right at the head, T2 landed) |

Verdict: APPROVE 55b51e700a0fb08e0a25efe88466fce6b95e9977
