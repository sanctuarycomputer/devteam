# Final review, pass 1 (track A): kit-46-standalone-hub (kit PR #238)

- Reviewer: final-a (fresh subagent of the supervisor, claude-opus)
- Reviewed: 4513dc5a4e899c8179a90429cca9304cda13809c

| Id | Severity | Rule cited | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec "What changes" 1 (owner actions spawned with `cwd: process.cwd()`) | devteam.mjs `startHub` `actionCwd`; `cmdOperatorThread` guard via `logWriter()` | A standalone hub started from a cwd inside a git checkout on a `plan/*` or `ticket/*` branch refuses every press and every `operator-thread status`. `logWriter()` reads the cwd's branch, so the child dies with "not from a plan-foo session" (I reproduced this with `operator-thread list` from a `plan/foo` repo). It fails closed and the spec asks for exactly this cwd. On the box the boot's cwd is kit-49's to choose. Worth one sentence in kit-49's boot, or in the help line. | deferred (Minor) |
| F2 | Minor | quality.md §6 (documents match the decision) | spec.md "What changes" 2, second bullet | The spec still says a dashboard's hub uses the own-kit guard. The plan's ruling (spec-2 F2-1) keeps a plain `kitVersion()` for a dashboard, and the code follows the plan. spec.md was never updated to match. | moot: f218627 gives a dashboard's hub the own-kit guard, as the spec says |
| F3 | Minor | none (hygiene) | test/hub-overview.test.mjs "the hub waits out another hub…" | When the test fails (mutant M7), the stand-in holder server `s` is never closed, so `node --test` hung for 18 minutes after the assertion failed and had to be killed. The holder servers should be closed in `t.after`. | deferred (Minor) |
| F4 | Suggestion | none | `startHub` `retry` | In standalone mode, `DEVTEAM_HUB_RETRY_MS=0` or a value that isn't a number gives a retry loop with no delay and no unref. The value comes only from the environment. | deferred (Suggestion) |

## What I checked and how

- Read quality.md §3, the playbook's open-PR step 2, the spec, plan, verification and task/spec/plan reviews, the design's kit-46 section, and the full diff `origin/main...4513dc5` outside `docs/devteam-dev`.
- Ran at 4513dc5 in the review worktree, one file at a time, with the required env: hub-overview 11/11 pass, operator-threads 19/19 pass, machine 23/23 pass. No port 4320 bound. Every test port is in the 20000–32699 block.
- Read `startHub` whole at the head. The request handler has no `standalone` branch. `ownHost`, the Origin, Sec-Fetch-Site and JSON content-type checks, `threadsNeedGateway()`, `gatewayProofProblem`, `seenNonces` and the child's own re-check of the proof (`cmdOperatorThread` `owner()`) are unchanged. The diff touches only the list head, the listen-error branch and the children's cwd.
- Box detection and the key: `onBox()`, `threadsNeedGateway()`, `gatewayThreadKey()` (BOX_THREAD_KEY when `/opt/devteam/gateway.mjs` exists), `operatorDir()` (`~/operator`) and the child's nonce store all depend on the env, the image's files and HOME. None depends on the cwd, mainRoot, runDir or projectDir. A hub run from a folder that is no checkout therefore uses the box's real key and nonce store. `DEVTEAM_BOX=off` only takes effect off the account's real HOME, and the boot uses the real HOME.
- Write paths: `operator-thread` (every verb, and `status`) and the hub itself never touch runDir, mainRoot, projectDir or the project log. The hub's log is `~/.devteam/hub-<port>.log`. The `hub` exemption from kit-201's DEVTEAM_RUN guard opens nothing: the only children are `operator-thread`, which was already exempt. `ownerActionEnv` still strips ROLE, TICKET, FEATURE and TMUX_PANE. Under `DEVTEAM_ROLE=operator`, the dispatch guard (line ~19216) still refuses `hub`.
- `--release`: `parseArgs` gives `''` for `--release ""`, `true` for a bare flag (mapped to `''`), and a space-joined string for several values. Without the `m` flag the regex anchors to the whole string, so a trailing newline or an `-rc` suffix is refused. A bad value is logged and served with `kit: null` and no `image`, and the hub never exits for it.
- `/instances.json` gains only `kit` (a release string or null) and `image`, under the existing cross-site refusal. The gateway relays it as data to the owner's signed-in page. `machine status` caps the read at 64 KB and 3 s and prints a release only if it matches `^[\w.+-]{1,64}$`.
- `DEVTEAM_IMAGE_HUB` yield: the dashboard yields only on a plain port equal to its `HUB_PORT`, and once it yields it never retries, so it can't win the port back. In any case, whatever holds the port runs the same `ownerPost` on a kit of this release. The older-kit restart gap is documented and owned by the design.
- Crash and restart: on a port that is held, or any listen error, the standalone hub keeps a non-unref'd timer and never exits. A crash exits 1 after logging. The 1 MB rotation is checked at each write.

## What I tried to break, and how it held (mutants in a scratch copy, each run against the named test)

| Mutant | Result |
|---|---|
| M1: the standalone hub skips the gateway signature (`boxed = !standalone && …`) | killed (operator-threads, standalone press test) |
| M2: the standalone hub skips its in-memory nonce check | killed (the replay comes back 400 from the child's store, not 403) |
| M3: the standalone hub skips the Origin check | killed |
| M4: the standalone hub skips the own-Host check | killed |
| M5: the standalone hub skips the list's Sec-Fetch-Site refusal | killed |
| M6: a dashboard yields for any `DEVTEAM_IMAGE_HUB` value | killed (hub-overview) |
| M7: the standalone hub gives up on a non-hub holder | killed (the test failed, then hung on its open holder server: F3) |
| M8: `hub` removed from the DEVTEAM_RUN exemption | killed |

A manual probe found F1. An unsigned, replayed or foreign-Origin press, a foreign Host, a missing or `same-site` Sec-Fetch-Site, a non-JSON body, and cross-site reads are all refused by the shipped test, and each check is pinned by a mutant above. I found no owner action that the standalone hub serves and the dashboard's hub didn't: `HUB_ACTIONS` is unchanged and the routing is shared.

Verdict: APPROVE 4513dc5a4e899c8179a90429cca9304cda13809c
